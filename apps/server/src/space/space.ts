// A space IS an Autobase: one multi-writer log shared by every peer who
// holds its invite. Corestore persists it, Hyperswarm replicates it,
// Autobase linearizes it, and blind-pairing turns invites into writers —
// all proven Pears modules, no custom protocol.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Corestore from 'corestore';
import Autobase from 'autobase';
import Hyperswarm from 'hyperswarm';
import BlindPairing from 'blind-pairing';
import b4a from 'b4a';
import hypercoreCrypto from 'hypercore-crypto';
import {
  FrithState,
  deviceBindingMessage,
  deviceRevokeMessage,
  evictMessage,
  epochMessage,
  inviteRotateMessage,
  roleMessage,
  settingMessage,
  logoMessage,
  channelDomain,
  type Domain,
  type Op,
  type SpaceLogo,
} from './state.js';
import { BlobStore } from './blobs.js';
import {
  deviceEncKeyPair,
  isSealedBytes,
  keyIdOf,
  newContentKey,
  openBytes,
  openContent,
  openKey,
  openSecret,
  sealBytes,
  sealContent,
  sealKey,
  sealSecret,
  sealedBytesKeyId,
  envelopeKeyId,
  isEnvelope,
  wrapsHash,
  type EncKeyPair,
} from './crypto.js';
import { decryptJson, encryptJson, fileKey, isEncrypted, resolveMasterKey } from './keys.js';

interface SpaceConfig {
  name: string;
  key: string | null; // autobase key (hex); null until first open assigns one
  dir: string; // corestore directory for this space
  invite?: string; // blind-pairing invite (hex) — the shareable capability
  invitePublicKey?: string; // member-side pairing credentials (creator holds these)
  inviteDiscoveryKey?: string;
  /** Shared log-encryption key (hex) — minted by the founder, handed to
   *  joiners inside the pairing handshake. Absent on pre-encryption spaces. */
  encryptionKey?: string;
  /** The user this device acts as (prod auth resolves to this). */
  boundUserId?: string;
  /** Root identity seeds held on this device: userId → 32-byte seed (hex).
   *  Only ever stored inside the encrypted registry. */
  identities?: Record<string, string>;
  /** This device's X25519 content-key keypair (hex). Its public half is
   *  published, root-vouched, in the device binding op; the secret never leaves. */
  deviceEncSecret?: string;
  deviceEncPublic?: string;
  /** Unwrapped content keys this device holds: keyId → 32-byte key (hex).
   *  Re-derivable from the log's wraps + deviceEncSecret; cached here so a
   *  restart doesn't have to re-open every seal. Encrypted with the registry. */
  contentKeys?: Record<string, string>;
}

/** Every space this instance belongs to, and which one is open. */
interface Registry {
  active: string; // dir of the open space
  spaces: SpaceConfig[];
}

type OpListener = (op: Op) => void;

const INVITE_PATTERN = /^frith:([^:]+):([0-9a-f]{40,})$/;

export function parseInvite(invite: string): { name: string; inviteHex: string } | null {
  const match = INVITE_PATTERN.exec(invite.trim());
  if (!match) return null;
  return { name: decodeURIComponent(match[1]!), inviteHex: match[2]! };
}

import type { AutobaseOptions } from 'autobase';

const baseOptions: AutobaseOptions = {
  valueEncoding: 'json',
  ackInterval: 1000,
  open: (viewStore) => viewStore.get({ name: 'ops', valueEncoding: 'json' }),
  apply: async (nodes, view, host) => {
    for (const node of nodes) {
      const op = node.value as Op;
      // add-writer ops are appended by existing writers when blind-pairing
      // admits a new instance (the canonical autobase onboarding).
      if (op?.t === 'add-writer') await host.addWriter(b4a.from(op.key, 'hex'), { indexer: true });
      // Envelope each op with the appending writer's key so the reducer can
      // check claimed authorship against verified device bindings.
      await view.append({ w: b4a.toString(node.from.key, 'hex'), op });
    }
  },
};

/** View records: writer-attributed envelopes; bare Ops in pre-envelope spaces. */
type ViewRecord = { w: string; op: Op } | Op;

class Space {
  state = new FrithState();
  name = 'local';
  private dataDir = '.frith-data';
  private _blobs: BlobStore | null = null;
  private store: Corestore | null = null;
  private base: Autobase | null = null;
  private swarm: Hyperswarm | null = null;
  private pairing: BlindPairing | null = null;
  private viewIndex = 0;
  private listeners: OpListener[] = [];
  private peers = 0;
  private peerListeners: ((count: number) => void)[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private replaying = false;
  /** Content keys this device can decrypt with: keyId → key (hex). Loaded from
   *  the registry on open, extended as epoch/grant wraps for us are applied. */
  private contentKeys = new Map<string, string>();
  private reconcilePromise: Promise<void> | null = null;
  /** The space block-encryption key of the open space (handed to joiners). */
  private _encKey: Buffer | null = null;
  /** This device's content-key keypair for the open space, or null if unbound. */
  private encPair: EncKeyPair | null = null;

  onOp(listener: OpListener) {
    this.listeners.push(listener);
  }

  onPeers(listener: (count: number) => void) {
    this.peerListeners.push(listener);
  }

  connectedPeers(): number {
    return this.peers;
  }

  get isOpen(): boolean {
    return this.base !== null;
  }

  debug() {
    return {
      viewLength: this.base?.view.length ?? -1,
      writable: this.base?.writable ?? false,
      baseLength: this.base?.length ?? -1,
      signedLength: this.base?.signedLength ?? -1,
      materialized: this.viewIndex,
      peers: this.peers,
    };
  }

  // One instance can belong to many spaces; spaces.json is the registry
  // (which spaces we know + which one is open). One space is open at a time —
  // switching closes the log and opens another.
  private registryPath() {
    return path.join(this.dataDir, 'spaces.json');
  }

  // The registry holds secrets (pairing credentials, space log keys,
  // identity seeds), so it lives encrypted under the device master key.
  private _fileKey: { dir: string; key: Buffer } | null = null;
  private fileKey(): Buffer {
    if (this._fileKey?.dir !== this.dataDir) {
      this._fileKey = { dir: this.dataDir, key: fileKey(resolveMasterKey(this.dataDir)) };
    }
    return this._fileKey.key;
  }

  private readRegistry(): Registry {
    try {
      const bytes = fs.readFileSync(this.registryPath());
      // Legacy plaintext registries still parse; the next write encrypts them.
      if (isEncrypted(bytes)) return decryptJson(this.fileKey(), bytes) as Registry;
      return JSON.parse(bytes.toString('utf8')) as Registry;
    } catch {
      // migrate the pre-registry single-space config, if any
      try {
        const legacy = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'space.json'), 'utf8')) as SpaceConfig;
        legacy.dir ??= legacy.key ? legacy.key.slice(0, 16) : 'local';
        return { active: legacy.dir, spaces: [legacy] };
      } catch {
        // Genuinely fresh instance — its default space is encrypted from
        // birth (open() persists this entry, so the key is minted once).
        return {
          active: 'local',
          spaces: [{ name: 'local', key: null, dir: 'local', encryptionKey: crypto.randomBytes(32).toString('hex') }],
        };
      }
    }
  }

  private writeRegistry(registry: Registry) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.registryPath(), encryptJson(this.fileKey(), registry), { mode: 0o600 });
  }

  private activeConfig(registry: Registry): SpaceConfig {
    return registry.spaces.find((s) => s.dir === registry.active) ?? registry.spaces[0]!;
  }

  invite(): string {
    return `frith:${encodeURIComponent(this.name)}:${this.activeConfig(this.readRegistry()).invite ?? ''}`;
  }

  listSpaces(): { active: string; spaces: { dir: string; name: string }[] } {
    const registry = this.readRegistry();
    return { active: registry.active, spaces: registry.spaces.map((s) => ({ dir: s.dir, name: s.name })) };
  }

  /** Close the open space and open another one we already belong to. */
  async switchSpace(dir: string): Promise<void> {
    const registry = this.readRegistry();
    if (!registry.spaces.some((s) => s.dir === dir)) throw new Error('no such space on this device');
    if (registry.active === dir && this.isOpen) return;
    await this.close();
    registry.active = dir;
    this.writeRegistry(registry);
    await this.open(this.dataDir);
  }

  async open(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    const registry = this.readRegistry();
    const config = this.activeConfig(registry);
    this.name = config.name;

    // Content keys this device already holds carry over from the last session.
    this.contentKeys = new Map(Object.entries(config.contentKeys ?? {}));
    this.encPair =
      config.deviceEncSecret && config.deviceEncPublic
        ? { publicKey: config.deviceEncPublic, secretKey: config.deviceEncSecret }
        : null;

    this.store = new Corestore(path.join(this.dataDir, config.dir));
    // The shared space key encrypts every core's blocks — at rest and on the
    // wire. Spaces from before encryption have no key and stay plaintext.
    const encKey = config.encryptionKey ? b4a.from(config.encryptionKey, 'hex') : null;
    this._encKey = encKey;
    this.base = new Autobase(this.store, config.key ? b4a.from(config.key, 'hex') : null, {
      ...baseOptions,
      encryptionKey: encKey,
    });
    await this.base.ready();

    // Attachment bytes live beside the log, in per-instance blob cores.
    this._blobs = new BlobStore(this.store, path.join(this.dataDir, `${config.dir}-blob-cache.json`), encKey);
    await this._blobs.ready();

    if (!config.key) config.key = b4a.toString(this.base.key, 'hex');
    // The founding instance mints the pairing credentials; the invite is the
    // shareable half, the public/discovery keys let this instance admit.
    if (!config.invite) {
      const minted = BlindPairing.createInvite(this.base.key);
      config.invite = b4a.toString(minted.invite, 'hex');
      config.invitePublicKey = b4a.toString(minted.publicKey, 'hex');
      config.inviteDiscoveryKey = b4a.toString(minted.discoveryKey, 'hex');
    }
    this.writeRegistry(registry); // config is an entry in it — minted keys persist

    // Initial materialization replays history silently (no fan-out).
    await this.base.update();
    await this.rebuild();
    // If the invite was rotated while we were away, adopt it before admitting.
    await this.syncInviteFromLog();
    this.base.view.on('append', () => void this.drain());
    // Autobase reorders the view when writers merge: on truncate, our state
    // isn't reversible, so rebuild it from the new linearization.
    this.base.view.on('truncate', () => void this.rebuild());
    this.refreshTimer = setInterval(() => void this.refresh(), 2000);

    if (process.env.NODE_ENV !== 'test') {
      this.startSwarm();
      void this.swarm!.join(this.base.discoveryKey, { server: true, client: true }).flushed();
      this.setupPairing(config);
    }
  }

  /** Admit newcomers with the current invite. Called on open and re-called after
   *  an eviction rotates the invite, so the old QR stops admitting. */
  private setupPairing(config: SpaceConfig) {
    if (!this.swarm || !config.invitePublicKey || !config.inviteDiscoveryKey) return;
    const publicKey = b4a.from(config.invitePublicKey, 'hex');
    this.pairing = new BlindPairing(this.swarm);
    this.pairing.addMember({
      discoveryKey: b4a.from(config.inviteDiscoveryKey, 'hex'),
      onadd: async (candidate) => {
        candidate.open(publicKey);
        const writerKey = candidate.userData;
        if (writerKey?.length === 32) {
          await this.append({ t: 'add-writer', key: b4a.toString(writerKey, 'hex') });
        }
        // The space log key rides inside the pairing handshake's encrypted
        // channel — the invite is the capability for it. Content keys are not
        // handed here; the joiner receives them via `grant` ops once it binds.
        candidate.confirm({ key: this.base!.key, encryptionKey: this._encKey });
      },
    });
  }

  private startSwarm() {
    this.swarm = new Hyperswarm();
    this.swarm.on('connection', (socket) => {
      this.peers += 1;
      for (const l of this.peerListeners) l(this.peers);
      socket.on('close', () => {
        this.peers -= 1;
        for (const l of this.peerListeners) l(this.peers);
      });
      this.store!.replicate(socket);
    });
  }

  /** Create a brand new space (fresh log) and become its founding instance. */
  async createSpace(name: string): Promise<void> {
    await this.close();
    this.state = new FrithState();
    this.viewIndex = 0;
    this.name = name;
    const registry = this.readRegistry();
    const dir = `space-${crypto.randomBytes(6).toString('hex')}`;
    // Founder mints the space's log-encryption key; joiners get it at pairing.
    registry.spaces.push({ name, key: null, dir, encryptionKey: crypto.randomBytes(32).toString('hex') });
    registry.active = dir;
    this.writeRegistry(registry);
    await this.open(this.dataDir);
    await this.append({ t: 'space', name });
  }

  /** Join an existing space: pair with an admitting member, then sync. */
  async joinSpace(name: string, inviteHex: string): Promise<void> {
    await this.close();
    const dir = `join-${crypto.createHash('sha256').update(inviteHex).digest('hex').slice(0, 12)}`;
    const store = new Corestore(path.join(this.dataDir, dir));
    const localCore = Autobase.getLocalCore(store);
    await localCore.ready();

    const swarm = new Hyperswarm();
    swarm.on('connection', (socket) => store.replicate(socket));
    const pairing = new BlindPairing(swarm);
    let baseKey: Buffer | null = null;
    let encryptionKey: Buffer | null = null;
    const candidate = pairing.addCandidate({
      invite: b4a.from(inviteHex, 'hex'),
      userData: localCore.key,
      onadd: (result) => {
        baseKey = result.key;
        encryptionKey = result.encryptionKey ?? null;
      },
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('pairing timed out — is a member instance online?')), 60_000),
    );
    try {
      await Promise.race([candidate.pairing, timeout]);
    } finally {
      await pairing.close().catch(() => {});
      await swarm.destroy().catch(() => {});
      await store.close().catch(() => {});
    }
    if (!baseKey) throw new Error('pairing did not return a space key');

    this.state = new FrithState();
    this.viewIndex = 0;
    this.name = name;
    const registry = this.readRegistry();
    registry.spaces = registry.spaces.filter((s) => s.dir !== dir); // re-join of a known space
    registry.spaces.push({
      name,
      key: b4a.toString(baseKey, 'hex'),
      dir,
      invite: inviteHex,
      // Pre-encryption spaces hand over no key and stay plaintext.
      encryptionKey: encryptionKey ? b4a.toString(encryptionKey, 'hex') : undefined,
    });
    registry.active = dir;
    this.writeRegistry(registry);
    await this.open(this.dataDir);
  }

  private async refresh(): Promise<void> {
    try {
      await this.base?.update();
      await this.drain();
    } catch {
      // transient while closing/switching
    }
  }

  private async rebuild(): Promise<void> {
    this.state = new FrithState();
    this.viewIndex = 0;
    this.replaying = true;
    try {
      await this.drain();
    } finally {
      this.replaying = false;
    }
  }

  private async drain(): Promise<void> {
    if (!this.base) return;
    while (this.viewIndex < this.base.view.length) {
      const record = (await this.base.view.get(this.viewIndex)) as ViewRecord;
      this.viewIndex += 1;
      const [op, writer] = 't' in record ? [record, undefined] : [record.op, record.w];
      this.state.apply(op, writer);
      this.absorbKeys(op);
      if (op.t === 'setting' && op.key === 'name') this.syncLocalName();
      if (!this.replaying) for (const listener of this.listeners) listener(op);
    }
    // Once caught up: adopt a rotated invite, rotate stale domains, and seal
    // keys to member devices still missing them. Both tolerate a mid-close
    // race — the next drain retries.
    if (!this.replaying) {
      void this.syncInviteFromLog().catch(() => {});
      void this.reconcile().catch(() => {});
    }
  }

  /** If an epoch/grant op carries a wrap addressed to this device, unwrap and
   *  cache the content key. Self-verifying: openKey rejects a mismatched hash. */
  private absorbKeys(op: Op): void {
    if (op.t !== 'epoch' && op.t !== 'grant') return;
    if (!this.encPair || !this.base || this.contentKeys.has(op.keyId)) return;
    const deviceKey = this.localDeviceKey();
    const sealed = op.t === 'epoch' ? op.wraps[deviceKey] : op.deviceKey === deviceKey ? op.sealed : undefined;
    if (!sealed) return;
    const keyHex = openKey(sealed, op.keyId, this.encPair);
    if (keyHex) this.cacheContentKey(op.keyId, keyHex);
  }

  /** Keep the key lattice healthy. Two walks over every domain:
   *  1. Rotation — if the current key is still sealed to a device that left the
   *     domain (evicted, revoked, unmembered), any local identity allowed to
   *     rotate mints a fresh key. This is what makes removal real regardless of
   *     WHICH peer performed it.
   *  2. Grants — seal keys this device holds to member devices missing them
   *     (newcomer onboarding), respecting historyVisibility.
   *  Serialized: concurrent calls share one in-flight pass; each walk is
   *  bounded because rotation/grants make their own triggers false. Public so
   *  membership changes can await the rotation they caused. */
  reconcile(): Promise<void> {
    if (!this.base?.writable) return Promise.resolve();
    this.reconcilePromise ??= this.reconcilePass().finally(() => {
      this.reconcilePromise = null;
    });
    return this.reconcilePromise;
  }

  private async reconcilePass(): Promise<void> {
    // Rotate stale domains first so grants below target the fresh keys.
    for (const domain of [...this.state.domains.keys()]) {
      const keyId = this.state.currentKeyId(domain);
      const record = keyId ? this.state.domains.get(domain)?.get(keyId) : null;
      if (!record) continue;
      const stale = Object.keys(record.wraps).some((d) => !this.state.deviceInDomain(d, domain));
      if (!stale || this.domainDevices(domain).size === 0) continue;
      const actor = this.localRotationActor(domain);
      if (actor) await this.mintEpoch(domain, actor);
    }
    const grants: Op[] = [];
    for (const domain of this.state.domains.keys()) {
      const keyIds =
        this.state.historyVisibility === 'full'
          ? this.state.keyIds(domain)
          : [this.state.currentKeyId(domain)].filter((k): k is string => k !== null);
      const targets = this.domainDevices(domain);
      for (const keyId of keyIds) {
        const keyHex = this.contentKeys.get(keyId);
        if (!keyHex) continue; // we don't hold it — can't seal it to anyone
        for (const [deviceKey, encPub] of targets) {
          if (deviceKey === this.localDeviceKey() || this.state.hasWrap(domain, keyId, deviceKey)) continue;
          grants.push({ t: 'grant', domain, keyId, deviceKey, sealed: sealKey(keyHex, encPub) });
        }
      }
    }
    for (const op of grants) await this.append(op);
  }

  /** A user this device can sign for who may rotate the domain — the bound
   *  user first, then any other locally-held identity (dev multi-profile). */
  private localRotationActor(domain: Domain): string | null {
    const identities = this.activeConfig(this.readRegistry()).identities ?? {};
    const candidates = [this.boundUserId(), ...Object.keys(identities)];
    for (const userId of candidates) {
      if (userId && identities[userId] && this.state.mayRotate(userId, domain)) return userId;
    }
    return null;
  }

  async append(op: Op): Promise<void> {
    if (!this.base) throw new Error('space not open');
    await this.base.append(op);
    await this.base.update();
    await this.drain();
  }

  async close(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    await this.pairing?.close().catch(() => {});
    this.pairing = null;
    await this.swarm?.destroy().catch(() => {});
    this.swarm = null;
    await this.base?.close().catch(() => {});
    this.base = null;
    this._blobs = null; // its cores close with the corestore
    await this.store?.close().catch(() => {});
    this.store = null;
    this.peers = 0;
  }

  get blobs(): BlobStore {
    if (!this._blobs) throw new Error('space not open');
    return this._blobs;
  }

  newId(): string {
    return crypto.randomUUID();
  }

  // ——— Identity: root keys certify device (writer) keys ———

  /** This device's autobase writer key — its identity as an op author. */
  localDeviceKey(): string {
    if (!this.base) throw new Error('space not open');
    return b4a.toString(this.base.local.key, 'hex');
  }

  /** The user this device acts as in the open space (prod auth), if bound. */
  boundUserId(): string | null {
    return this.activeConfig(this.readRegistry()).boundUserId ?? null;
  }

  /** The root seed for a user, if this device holds it (export / revoke). */
  identitySeed(userId: string): string | null {
    return this.activeConfig(this.readRegistry()).identities?.[userId] ?? null;
  }

  /**
   * Bind this device to a user: publish the root key (first write wins) and
   * a root-signed device certification, then remember the seed — encrypted —
   * so this device can later link others or revoke a stolen one.
   */
  async bindLocalDevice(userId: string, seedHex: string): Promise<void> {
    const seed = b4a.from(seedHex, 'hex');
    if (seed.length !== 32) throw new Error('identity seed must be 32 bytes of hex');
    const pair = hypercoreCrypto.keyPair(seed);
    const rootKey = b4a.toString(pair.publicKey, 'hex');
    const onLog = this.state.roots.get(userId);
    if (onLog && onLog !== rootKey) throw new Error('that user already has a different root identity');
    const deviceKey = this.localDeviceKey();

    // Mint (or reuse) this device's content-key keypair and persist identity
    // material *before* appending, so an initial rotation can sign and seal.
    const registry = this.readRegistry();
    const config = this.activeConfig(registry);
    const enc: EncKeyPair =
      config.deviceEncSecret && config.deviceEncPublic
        ? { publicKey: config.deviceEncPublic, secretKey: config.deviceEncSecret }
        : deviceEncKeyPair();
    config.deviceEncPublic = enc.publicKey;
    config.deviceEncSecret = enc.secretKey;
    config.identities = { ...config.identities, [userId]: seedHex };
    config.boundUserId = userId;
    this.writeRegistry(registry);
    this.encPair = enc;

    if (!onLog) await this.append({ t: 'identity', userId, rootKey });
    // The enc public key is signed into the binding so it can't be spoofed.
    const sig = b4a.toString(
      hypercoreCrypto.sign(b4a.from(deviceBindingMessage(userId, deviceKey, enc.publicKey)), pair.secretKey),
      'hex',
    );
    await this.append({ t: 'device', userId, deviceKey, encPubKey: enc.publicKey, sig });

    // The owner's first binding establishes the space's content keychain.
    if (this.state.ownerUserId === userId && this.state.currentKeyId('space') === null) {
      await this.mintEpoch('space', userId);
    }
  }

  /** Root-sign a revocation for one of the user's devices (theft response). */
  async revokeDevice(userId: string, deviceKey: string): Promise<void> {
    const seedHex = this.identitySeed(userId);
    if (!seedHex) throw new Error('this device does not hold that identity');
    const pair = hypercoreCrypto.keyPair(b4a.from(seedHex, 'hex'));
    const sig = b4a.toString(hypercoreCrypto.sign(b4a.from(deviceRevokeMessage(userId, deviceKey)), pair.secretKey), 'hex');
    await this.append({ t: 'device-revoke', userId, deviceKey, sig });
  }

  // ——— Membership control: roles, eviction, content-key rotation ———

  /** May this user evict / rotate? Evaluated per request — in dev the acting
   *  cookie user and the device's bound user can differ. */
  canManage(userId: string | null | undefined = this.boundUserId()): boolean {
    return userId != null && this.state.canManage(userId);
  }

  isOwner(userId: string | null | undefined = this.boundUserId()): boolean {
    return userId != null && userId === this.state.ownerUserId;
  }

  /** Owner grants/revokes admin. Explicit actor for the same reason as
   *  evictUser: the acting user and the device's bound user can differ. */
  async setAdmin(userId: string, on: boolean, actorId: string): Promise<void> {
    if (actorId !== this.state.ownerUserId) throw new Error('only the owner manages admins');
    if (!this.state.users.has(userId) && !this.state.roots.has(userId)) throw new Error('no such member');
    await this.append({ t: 'role', userId, role: 'admin', on, actorId, sig: this.signAsRoot(actorId, roleMessage(userId, 'admin', on)) });
  }

  /** Owner chooses whether newcomers can read pre-join history. */
  async setHistoryVisibility(value: 'full' | 'join-forward', actorId: string): Promise<void> {
    if (actorId !== this.state.ownerUserId) throw new Error('only the owner changes space settings');
    await this.append({ t: 'setting', key: 'historyVisibility', value, actorId, sig: this.signAsRoot(actorId, settingMessage('historyVisibility', value)) });
  }

  /** Managers (owner or admin) rename the space or edit its description. */
  private async setSetting(key: 'name' | 'description', value: string, actorId: string): Promise<void> {
    if (!this.state.canManage(actorId)) throw new Error('only owner or admins can change space settings');
    await this.append({ t: 'setting', key, value, actorId, sig: this.signAsRoot(actorId, settingMessage(key, value)) });
    if (key === 'name') this.syncLocalName();
  }

  async renameSpace(name: string, actorId: string): Promise<void> {
    if (!name.trim()) throw new Error('a space needs a name');
    await this.setSetting('name', name.trim(), actorId);
  }

  async setDescription(description: string, actorId: string): Promise<void> {
    await this.setSetting('description', description.trim(), actorId);
  }

  /** Managers set (or clear, with null) the space logo. `logo` already points at
   *  bytes put into a blob core; the hash is signed so peers can trust it. */
  async setLogo(logo: SpaceLogo | null, actorId: string): Promise<void> {
    if (!this.state.canManage(actorId)) throw new Error('only owner or admins can change the logo');
    await this.append({ t: 'logo', logo, actorId, sig: this.signAsRoot(actorId, logoMessage(logo?.hash ?? null)) });
  }

  /** After a rename lands in the log, fold the new name into this device's
   *  registry so the space switcher and invite label track it too. */
  private syncLocalName(): void {
    const name = this.state.spaceName;
    if (!name || name === this.name) return;
    this.name = name;
    const registry = this.readRegistry();
    const config = this.activeConfig(registry);
    if (config.name !== name) {
      config.name = name;
      this.writeRegistry(registry);
    }
  }

  /**
   * Evict a user from the whole space: revoke their devices, drop their
   * memberships, rotate every content key they could read (space + their
   * private channels, via reconcile's stale-wrap walk), and rotate the invite
   * on every admitting device so the old QR can't re-admit them.
   */
  async evictUser(userId: string, actorId: string): Promise<void> {
    if (!this.state.canManage(actorId)) throw new Error('only owner or admins can evict');
    if (userId === this.state.ownerUserId) throw new Error('the owner cannot be evicted');
    if (!this.state.users.has(userId) && !this.state.roots.has(userId)) throw new Error('no such member');
    await this.append({ t: 'evict', userId, actorId, sig: this.signAsRoot(actorId, evictMessage(userId)) });
    // The evict op dropped their devices/memberships, so every domain whose
    // current key is still sealed to them is now stale — rotate them all.
    await this.reconcile();
    await this.rotateInvite(actorId);
  }

  /** Mint a domain's first content key if the actor may — the soft path used
   *  when a private channel is created or first written to. */
  async ensureDomainKey(domain: Domain, actorId: string): Promise<void> {
    if (this.state.currentKeyId(domain) !== null) return;
    if (!this.identitySeed(actorId) || !this.state.mayRotate(actorId, domain)) return;
    if (this.domainDevices(domain).size === 0) return; // nobody could unwrap it
    await this.mintEpoch(domain, actorId);
  }

  /** Mint a fresh content key for a domain, sealed to its current member devices. */
  private async mintEpoch(domain: Domain, actorId: string): Promise<void> {
    if (!this.state.mayRotate(actorId, domain)) throw new Error('not allowed to rotate keys for this domain');
    const keyHex = newContentKey();
    const keyId = keyIdOf(keyHex);
    const seq = this.state.nextSeq(domain);
    const wraps: Record<string, string> = {};
    for (const [deviceKey, encPub] of this.domainDevices(domain)) wraps[deviceKey] = sealKey(keyHex, encPub);
    this.cacheContentKey(keyId, keyHex); // hold it before it round-trips the log
    const sig = this.signAsRoot(actorId, epochMessage(domain, keyId, seq, wrapsHash(wraps)));
    await this.append({ t: 'epoch', domain, keyId, seq, wraps, actorId, sig });
  }

  /** Roll the blind-pairing invite via the log: new public credentials for
   *  every admitting device, the invite secret sealed per member device. Honest
   *  peers rebind and the old QR stops admitting everywhere. */
  private async rotateInvite(actorId: string): Promise<void> {
    if (!this.base) return;
    if (!this.state.canManage(actorId)) throw new Error('only owner or admins can rotate the invite');
    const minted = BlindPairing.createInvite(this.base.key);
    const inviteHex = b4a.toString(minted.invite, 'hex');
    const publicKey = b4a.toString(minted.publicKey, 'hex');
    const discoveryKey = b4a.toString(minted.discoveryKey, 'hex');
    const wraps: Record<string, string> = {};
    for (const [deviceKey, encPub] of this.domainDevices('space')) wraps[deviceKey] = sealSecret(inviteHex, encPub);
    const seq = (this.state.currentInvite?.seq ?? 0) + 1;
    const sig = this.signAsRoot(actorId, inviteRotateMessage(seq, publicKey, discoveryKey, wrapsHash(wraps)));
    await this.append({ t: 'invite-rotate', seq, publicKey, discoveryKey, wraps, actorId, sig });
    // We minted it, so remember the secret even if our device has no enc key.
    await this.adoptInvite({ invite: inviteHex, publicKey, discoveryKey });
  }

  /** Fold the log's current invite into this device's registry and re-arm the
   *  admitting loop. Called after drain — every honest member device converges
   *  on admitting ONLY the newest invite. */
  private async syncInviteFromLog(): Promise<void> {
    const cur = this.state.currentInvite;
    if (!cur || !this.base) return;
    const config = this.activeConfig(this.readRegistry());
    if (config.inviteDiscoveryKey === cur.discoveryKey) return; // already current
    const sealed = cur.wraps[this.localDeviceKey()];
    const inviteHex = sealed && this.encPair ? openSecret(sealed, this.encPair) : null;
    // Without a wrap we can still admit (credentials are public); we just
    // can't display the invite string for sharing.
    await this.adoptInvite({ invite: inviteHex ?? '', publicKey: cur.publicKey, discoveryKey: cur.discoveryKey });
  }

  private async adoptInvite(next: { invite: string; publicKey: string; discoveryKey: string }): Promise<void> {
    const registry = this.readRegistry();
    const config = this.activeConfig(registry);
    if (
      config.invite === next.invite &&
      config.invitePublicKey === next.publicKey &&
      config.inviteDiscoveryKey === next.discoveryKey
    )
      return;
    config.invite = next.invite;
    config.invitePublicKey = next.publicKey;
    config.inviteDiscoveryKey = next.discoveryKey;
    this.writeRegistry(registry);
    if (this.swarm) {
      await this.pairing?.close().catch(() => {});
      this.pairing = null;
      this.setupPairing(config);
    }
  }

  // ——— Content-key helpers ———

  /** Non-revoked, non-evicted devices in a domain, with their enc public keys.
   *  The space domain is everyone; a channel domain is that channel's members. */
  private domainDevices(domain: Domain): Map<string, string> {
    const memberFilter = domain === 'space' ? null : this.state.members.get(domain.slice('channel:'.length));
    const targets = new Map<string, string>();
    for (const [deviceKey, userId] of this.state.deviceOwners) {
      if (this.state.revokedDevices.has(deviceKey) || this.state.evicted.has(userId)) continue;
      if (memberFilter && !memberFilter.has(userId)) continue;
      const encPub = this.state.deviceEncKeys.get(deviceKey);
      if (encPub) targets.set(deviceKey, encPub);
    }
    return targets;
  }

  private signAsRoot(userId: string, message: string): string {
    const seedHex = this.identitySeed(userId);
    if (!seedHex) throw new Error('this device does not hold that identity');
    const pair = hypercoreCrypto.keyPair(b4a.from(seedHex, 'hex'));
    return b4a.toString(hypercoreCrypto.sign(b4a.from(message), pair.secretKey), 'hex');
  }

  private cacheContentKey(keyId: string, keyHex: string): void {
    if (this.contentKeys.get(keyId) === keyHex) return;
    this.contentKeys.set(keyId, keyHex);
    const registry = this.readRegistry();
    const config = this.activeConfig(registry);
    config.contentKeys = { ...config.contentKeys, [keyId]: keyHex };
    this.writeRegistry(registry);
  }

  /** The domain a channel's messages encrypt under: its own if private, else the
   *  space domain (public channels are readable by every member). */
  contentDomain(channelType: 'public' | 'private' | 'dm', channelId: string): Domain {
    return channelType === 'public' ? 'space' : channelDomain(channelId);
  }

  /** Encrypt a body under a domain's current key; plaintext if none yet (legacy). */
  encryptBody(domain: Domain, plaintext: string): string {
    const keyId = this.state.currentKeyId(domain);
    if (!keyId) return plaintext;
    const keyHex = this.contentKeys.get(keyId);
    if (!keyHex) return plaintext; // not yet holding the key — post in the clear rather than lose the message
    return sealContent(keyHex, plaintext);
  }

  /** Decrypt a stored body. Returns null when we lack the key (caller shows a lock). */
  decryptBody(body: string): string | null {
    if (!isEnvelope(body)) return body; // legacy plaintext or already clear
    const keyId = envelopeKeyId(body);
    const keyHex = keyId ? this.contentKeys.get(keyId) : undefined;
    if (!keyHex) return null;
    try {
      return openContent(keyHex, body);
    } catch {
      return null;
    }
  }

  /** Encrypt blob bytes under a domain's current key; passthrough pre-key. */
  encryptBytes(domain: Domain, bytes: Buffer): Buffer {
    const keyId = this.state.currentKeyId(domain);
    const keyHex = keyId ? this.contentKeys.get(keyId) : undefined;
    return keyHex ? sealBytes(keyHex, bytes) : bytes;
  }

  /** Decrypt sealed blob bytes. Null when the key is missing (show a lock);
   *  legacy plaintext blobs pass through untouched. */
  decryptBytes(bytes: Buffer): Buffer | null {
    if (!isSealedBytes(bytes)) return bytes;
    const keyId = sealedBytesKeyId(bytes);
    const keyHex = keyId ? this.contentKeys.get(keyId) : undefined;
    return keyHex ? openBytes(keyHex, bytes) : null;
  }
}

export const space = new Space();
