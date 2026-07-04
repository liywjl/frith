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
import { LoreState, type Op } from './state.js';
import { BlobStore } from './blobs.js';

interface SpaceConfig {
  name: string;
  key: string | null; // autobase key (hex); null until first open assigns one
  dir: string; // corestore directory for this space
  invite?: string; // blind-pairing invite (hex) — the shareable capability
  invitePublicKey?: string; // member-side pairing credentials (creator holds these)
  inviteDiscoveryKey?: string;
}

type OpListener = (op: Op) => void;

const INVITE_PATTERN = /^lore:([^:]+):([0-9a-f]{40,})$/;

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
      await view.append(op);
    }
  },
};

class Space {
  state = new LoreState();
  name = 'local';
  private dataDir = '.lore-data';
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

  private configPath() {
    return path.join(this.dataDir, 'space.json');
  }

  private readConfig(): SpaceConfig {
    try {
      const config = JSON.parse(fs.readFileSync(this.configPath(), 'utf8')) as SpaceConfig;
      config.dir ??= config.key ? config.key.slice(0, 16) : 'local';
      return config;
    } catch {
      return { name: 'local', key: null, dir: 'local' };
    }
  }

  private writeConfig(config: SpaceConfig) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.configPath(), JSON.stringify(config));
  }

  invite(): string {
    return `lore:${encodeURIComponent(this.name)}:${this.readConfig().invite ?? ''}`;
  }

  async open(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    const config = this.readConfig();
    this.name = config.name;

    this.store = new Corestore(path.join(this.dataDir, config.dir));
    this.base = new Autobase(this.store, config.key ? b4a.from(config.key, 'hex') : null, baseOptions);
    await this.base.ready();

    // Attachment bytes live beside the log, in per-instance blob cores.
    this._blobs = new BlobStore(this.store, path.join(this.dataDir, `${config.dir}-blob-cache.json`));
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
    this.writeConfig(config);

    // Initial materialization replays history silently (no fan-out).
    await this.base.update();
    await this.rebuild();
    this.base.view.on('append', () => void this.drain());
    // Autobase reorders the view when writers merge: on truncate, our state
    // isn't reversible, so rebuild it from the new linearization.
    this.base.view.on('truncate', () => void this.rebuild());
    this.refreshTimer = setInterval(() => void this.refresh(), 2000);

    if (process.env.NODE_ENV !== 'test') {
      this.startSwarm();
      void this.swarm!.join(this.base.discoveryKey, { server: true, client: true }).flushed();
      // Admit newcomers if we hold the pairing credentials.
      if (config.invitePublicKey && config.inviteDiscoveryKey) {
        this.pairing = new BlindPairing(this.swarm!);
        const publicKey = b4a.from(config.invitePublicKey, 'hex');
        this.pairing.addMember({
          discoveryKey: b4a.from(config.inviteDiscoveryKey, 'hex'),
          onadd: async (candidate) => {
            candidate.open(publicKey);
            const writerKey = candidate.userData;
            if (writerKey?.length === 32) {
              await this.append({ t: 'add-writer', key: b4a.toString(writerKey, 'hex') });
            }
            candidate.confirm({ key: this.base!.key });
          },
        });
      }
    }
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
    this.state = new LoreState();
    this.viewIndex = 0;
    this.name = name;
    this.writeConfig({ name, key: null, dir: `space-${crypto.randomBytes(6).toString('hex')}` });
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
    const candidate = pairing.addCandidate({
      invite: b4a.from(inviteHex, 'hex'),
      userData: localCore.key,
      onadd: (result) => {
        baseKey = result.key;
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

    this.state = new LoreState();
    this.viewIndex = 0;
    this.name = name;
    this.writeConfig({ name, key: b4a.toString(baseKey, 'hex'), dir, invite: inviteHex });
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
    this.state = new LoreState();
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
      const op = (await this.base.view.get(this.viewIndex)) as Op;
      this.viewIndex += 1;
      this.state.apply(op);
      if (!this.replaying) for (const listener of this.listeners) listener(op);
    }
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
}

export const space = new Space();
