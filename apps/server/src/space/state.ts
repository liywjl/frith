// Frith's entire dataset, materialized in memory from the space's Autobase
// log. Every mutation in the app is an Op appended to the log; this class is
// the deterministic reducer that turns the linearized ops back into state —
// on every peer, identically.
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import { wrapsHash } from './crypto.js';

export interface UserRow {
  id: string;
  handle: string;
  name: string;
  title: string | null;
  team: string | null;
  avatarEmoji: string | null;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  interests: string[];
  nowPlaying: string | null;
  /** When nowPlaying was last changed — lets the feed date "enjoying" items. */
  nowPlayingAt: string | null;
  bio: string | null;
  links: { label: string; url: string }[];
  accentColor: string | null;
  /** Where they are (or claim to be) — profile flavour, free text. */
  location: string | null;
  theme: string;
}

export interface ChannelRow {
  id: string;
  name: string;
  type: 'public' | 'private' | 'dm';
  topic: string | null;
  archivedAt: string | null;
}

export interface MessageRow {
  id: string;
  channelId: string;
  authorId: string;
  parentMessageId: string | null;
  body: string;
  createdAt: string;
  /** Did the appending device provably belong to authorId? Computed by the
   *  reducer from writer attribution; undefined for legacy/unbound writers. */
  verified?: boolean;
}

export interface AttachmentRow {
  id: string;
  messageId: string;
  name: string;
  mime: string;
  size: number;
  /** sha256 of the bytes — verified when fetched from a peer. */
  hash?: string;
  /** Where the bytes live: which instance's blob core, and where in it.
   *  Absent on pre-blob attachments (bytes on the uploader's disk only). */
  blob?: { key: string; id: BlobId };
}

/** Hyperblobs' locator for one blob within a core. */
export interface BlobId {
  blockOffset: number;
  blockLength: number;
  byteOffset: number;
  byteLength: number;
}

/** The space's logo image: a blob reference plus the bytes' hash (verified on
 *  fetch) and mime (for serving). Set by a manager, cleared to null. */
export interface SpaceLogo {
  key: string;
  id: BlobId;
  hash: string;
  mime: string;
}

/** A shared doc — the space's living pages. Title and body are sealed under
 *  the space content key, like message bodies. Whole-doc last-write-wins. */
export interface DocRow {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ScheduledRow {
  id: string;
  channelId: string;
  authorId: string;
  parentMessageId: string | null;
  body: string;
  sendAt: string;
}

/** What a root key signs to (un)bind a device. Deterministic across peers.
 *  `encPubKey` binds the device's X25519 content-key public key into the same
 *  root signature, so a peer can't publish a bogus enc key for someone's device.
 *  Legacy device ops carry no enc key and sign the two-part message unchanged. */
export const deviceBindingMessage = (userId: string, deviceKey: string, encPubKey?: string) =>
  encPubKey ? `frith:device:${userId}:${deviceKey}:${encPubKey}` : `frith:device:${userId}:${deviceKey}`;
export const deviceRevokeMessage = (userId: string, deviceKey: string) => `frith:device-revoke:${userId}:${deviceKey}`;
/** Owner-signed admin (un)grant. */
export const roleMessage = (userId: string, role: string, on: boolean) => `frith:role:${userId}:${role}:${on}`;
/** Manager-signed eviction of a user from the whole space. The op names its
 *  actor and the signature alone authorizes it (no writer coupling), which is
 *  replay-safe because eviction is sticky — re-applying is a no-op. */
export const evictMessage = (userId: string) => `frith:evict:${userId}`;
/** Signed content-key rotation for a domain. `wrapsHash` binds the sealed key
 *  map into the signature so a copied op with altered wraps fails verification.
 *  Replay-safe: epochs are idempotent by keyId and monotone by seq. */
export const epochMessage = (domain: string, keyId: string, seq: number, wrapsHash: string) =>
  `frith:epoch:${domain}:${keyId}:${seq}:${wrapsHash}`;
/** Manager-signed invite rotation — same discipline as epochs. */
export const inviteRotateMessage = (seq: number, publicKey: string, discoveryKey: string, wrapsHash: string) =>
  `frith:invite:${seq}:${publicKey}:${discoveryKey}:${wrapsHash}`;
/** Manager-signed space setting change (name/description owner-or-admin;
 *  historyVisibility owner-only — enforced in the reducer). */
export const settingMessage = (key: string, value: string) => `frith:setting:${key}:${value}`;
/** Manager-signed space logo change; the hash covers the bytes, null clears it. */
export const logoMessage = (hash: string | null) => `frith:logo:${hash ?? 'none'}`;

/** A domain is a set of devices sharing a content keychain: the whole space
 *  ("space", covering public channels) or one private channel ("channel:<id>"). */
export type Domain = 'space' | `channel:${string}`;
export const channelDomain = (channelId: string): Domain => `channel:${channelId}`;

/** One content key's public record: who it is sealed to, and its ordering. */
interface EpochRecord {
  seq: number;
  keyId: string;
  wraps: Record<string, string>; // deviceKey → sealed content key (hex)
}

export type Op =
  | { t: 'add-writer'; key: string } // appended by a member when pairing admits a new instance
  | { t: 'space'; name: string }
  // Identity: a user's root ed25519 key (first write wins), and device keys
  // (= autobase writer keys) the root signs in or out. Ops with bad
  // signatures are ignored by every peer identically.
  | { t: 'identity'; userId: string; rootKey: string }
  | { t: 'device'; userId: string; deviceKey: string; sig: string; encPubKey?: string }
  | { t: 'device-revoke'; userId: string; deviceKey: string; sig: string }
  // Membership control: the owner grants admins; owner/admins evict users and
  // rotate content keys. All are root-signed and authorization-checked, so a
  // forged or unauthorized op is discarded identically on every peer.
  | { t: 'role'; userId: string; role: 'admin'; on: boolean; actorId: string; sig: string }
  | { t: 'evict'; userId: string; actorId: string; sig: string }
  | { t: 'setting'; key: 'historyVisibility' | 'name' | 'description'; value: string; actorId: string; sig: string }
  | { t: 'logo'; logo: SpaceLogo | null; actorId: string; sig: string }
  // Content-key distribution. `epoch` mints a new current key for a domain
  // (authorized). `grant` seals an existing key to one more device to onboard a
  // newcomer — unsigned but self-verifying, since the recipient checks the
  // unwrapped key's hash against keyId.
  | { t: 'epoch'; domain: Domain; keyId: string; seq: number; wraps: Record<string, string>; actorId: string; sig: string }
  | { t: 'grant'; domain: Domain; keyId: string; deviceKey: string; sealed: string }
  // Invite rotation: new pairing credentials for every admitting device, with
  // the invite secret sealed per member device so all peers share one invite.
  | {
      t: 'invite-rotate';
      seq: number;
      publicKey: string;
      discoveryKey: string;
      wraps: Record<string, string>;
      actorId: string;
      sig: string;
    }
  | { t: 'user'; id: string; patch: Partial<UserRow> & Pick<UserRow, 'handle' | 'name'> }
  | { t: 'channel'; channel: ChannelRow }
  | { t: 'archive'; channelId: string; archived: boolean; at: string }
  | { t: 'member'; channelId: string; userId: string }
  | { t: 'unmember'; channelId: string; userId: string }
  | { t: 'msg'; message: MessageRow }
  | { t: 'att'; attachment: AttachmentRow }
  | { t: 'react'; messageId: string; userId: string; emoji: string; on: boolean }
  | { t: 'read'; userId: string; channelId: string; at: string }
  | { t: 'block'; userId: string; blockedId: string; on: boolean }
  | { t: 'pin'; userId: string; channelId: string; on: boolean }
  | { t: 'pins'; userId: string; channelIds: string[] }
  | { t: 'sched'; scheduled: ScheduledRow }
  | { t: 'unsched'; id: string }
  | { t: 'doc'; doc: DocRow }
  | { t: 'doc-remove'; docId: string };

const defaultUser = (id: string): UserRow => ({
  id,
  handle: '',
  name: '',
  title: null,
  team: null,
  avatarEmoji: null,
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  interests: [],
  nowPlaying: null,
  nowPlayingAt: null,
  bio: null,
  links: [],
  accentColor: null,
  location: null,
  theme: 'ocean',
});

/** Rate bounding (HARDENING §1). Every peer replays and materializes every
 *  op, so an admitted writer must not be able to grow honest peers' state
 *  without bound. Each writer spends 1 credit per op and earns credit only
 *  from other writers' interleaved ops — log position is the clock, so a
 *  from-scratch replay reaches the identical verdict on every peer (wall
 *  clocks would not). A lone spammer is capped at the burst; a writer in an
 *  active space earns headroom from the activity around it, sustaining up to
 *  CREDITS_PER_OTHER_OP times everyone else's combined rate before going
 *  inert. Colluding admitted writers can feed each other credit — that is a
 *  membership problem (eviction, HARDENING §2), not a rate one. */
export const WRITER_BURST = 4096; // opening balance and bank cap, in ops
export const CREDITS_PER_OTHER_OP = 64;

const verifySig = (message: string, sigHex: string, publicKeyHex: string): boolean => {
  try {
    return hypercoreCrypto.verify(b4a.from(message), b4a.from(sigHex, 'hex'), b4a.from(publicKeyHex, 'hex'));
  } catch {
    return false; // malformed hex/lengths — treat like a bad signature
  }
};

export class FrithState {
  spaceName: string | null = null;
  /** A one-line description of what the space is for; null until a manager sets it. */
  spaceDescription: string | null = null;
  /** The space's logo image, or null. Managers set/clear it. */
  spaceLogo: SpaceLogo | null = null;
  users = new Map<string, UserRow>();
  /** userId → root identity public key (hex). Immutable once set. */
  roots = new Map<string, string>();
  /** device (writer) key → userId, for devices whose binding verified. */
  deviceOwners = new Map<string, string>();
  /** Revoked device keys can never re-bind — a replayed 'device' op after
   *  an Autobase reorder must not resurrect the binding. */
  revokedDevices = new Set<string>();
  /** device (writer) key → its X25519 content-key public key (root-vouched). */
  deviceEncKeys = new Map<string, string>();
  /** The space owner: author of the first `identity` op. Immutable once set. */
  ownerUserId: string | null = null;
  /** Users the owner has made admins. */
  admins = new Set<string>();
  /** Users evicted from the space — their devices are revoked, memberships dropped. */
  evicted = new Set<string>();
  /** domain → keyId → content-key record. Public data only; the plaintext keys
   *  live in each device's encrypted registry, re-derived from these wraps. */
  domains = new Map<Domain, Map<string, EpochRecord>>();
  /** Whether newcomers are granted the whole keychain or only the current key. */
  historyVisibility: 'full' | 'join-forward' = 'full';
  /** The pairing credentials every admitting device should use, once an
   *  invite rotation has happened. Null = the founder's original invite. */
  currentInvite: { seq: number; publicKey: string; discoveryKey: string; wraps: Record<string, string> } | null = null;
  channels = new Map<string, ChannelRow>();
  members = new Map<string, Set<string>>(); // channelId → userIds
  messages = new Map<string, MessageRow>();
  messagesByChannel = new Map<string, string[]>();
  reactions = new Map<string, Map<string, true>>(); // messageId → `${userId}:${emoji}`
  reads = new Map<string, string>(); // `${userId}:${channelId}` → ISO
  blocks = new Map<string, Set<string>>();
  pins = new Map<string, Map<string, number>>(); // userId → channelId → position
  scheduled = new Map<string, ScheduledRow>();
  attachments = new Map<string, AttachmentRow>();
  attachmentsByMessage = new Map<string, AttachmentRow[]>();
  docs = new Map<string, DocRow>();
  /** Deleted doc ids stay deleted — a reordered stale edit must not resurrect. */
  removedDocs = new Set<string>();
  /** Total enveloped ops applied — the logical clock for writer budgets. */
  private opSeq = 0;
  /** writer key → banked credit and the clock reading at their last op. */
  private writerBudgets = new Map<string, { credit: number; lastSeq: number }>();
  /** Writers that ran over budget — their excess ops were skipped as inert. */
  flaggedWriters = new Set<string>();

  memberSet(channelId: string): Set<string> {
    let set = this.members.get(channelId);
    if (!set) {
      set = new Set();
      this.members.set(channelId, set);
    }
    return set;
  }

  /** The user behind an appending writer, if its device binding verified and
   *  the user holds a known root — else null (unauthorized to act). */
  private actor(writer?: string): string | null {
    if (writer === undefined) return null;
    const userId = this.deviceOwners.get(writer);
    return userId && this.roots.has(userId) ? userId : null;
  }

  /** Owner or admin: may evict and rotate. */
  canManage(userId: string): boolean {
    return userId === this.ownerUserId || this.admins.has(userId);
  }

  /** Who may mint a content key for a domain: managers always; a private
   *  channel's current members may rotate their own channel. */
  mayRotate(userId: string, domain: Domain): boolean {
    if (this.evicted.has(userId)) return false;
    if (this.canManage(userId)) return true;
    if (domain === 'space') return false;
    return this.members.get(domain.slice('channel:'.length))?.has(userId) ?? false;
  }

  /** Is a device eligible to receive a domain's keys? Bound, unrevoked, its
   *  user not evicted — and for channel domains, its user a current member. */
  deviceInDomain(deviceKey: string, domain: Domain): boolean {
    if (this.revokedDevices.has(deviceKey)) return false;
    const ownerId = this.deviceOwners.get(deviceKey);
    if (!ownerId || this.evicted.has(ownerId)) return false;
    if (domain === 'space') return true;
    return this.members.get(domain.slice('channel:'.length))?.has(ownerId) ?? false;
  }

  private epochsFor(domain: Domain): Map<string, EpochRecord> {
    let chain = this.domains.get(domain);
    if (!chain) {
      chain = new Map();
      this.domains.set(domain, chain);
    }
    return chain;
  }

  /** The keyId new writes in a domain should use. Deterministic across peers:
   *  the live key with the greatest (seq, keyId), so concurrent rotations
   *  converge while every past key stays decryptable. Null before any epoch. */
  currentKeyId(domain: Domain): string | null {
    let best: EpochRecord | null = null;
    for (const record of this.domains.get(domain)?.values() ?? []) {
      if (!best || record.seq > best.seq || (record.seq === best.seq && record.keyId > best.keyId)) best = record;
    }
    return best?.keyId ?? null;
  }

  /** The seq a freshly minted key in this domain should carry. */
  nextSeq(domain: Domain): number {
    let max = -1;
    for (const record of this.domains.get(domain)?.values() ?? []) max = Math.max(max, record.seq);
    return max + 1;
  }

  /** Every keyId known for a domain (for full-history grants). */
  keyIds(domain: Domain): string[] {
    return [...(this.domains.get(domain)?.keys() ?? [])];
  }

  /** Whether a device already holds a wrap for a domain key. */
  hasWrap(domain: Domain, keyId: string, deviceKey: string): boolean {
    return this.domains.get(domain)?.get(keyId)?.wraps[deviceKey] !== undefined;
  }

  /** Spend one credit for an op from `writer`. False means the writer is over
   *  budget: flag it and leave the op inert. */
  private chargeWriter(writer: string): boolean {
    this.opSeq += 1;
    let budget = this.writerBudgets.get(writer);
    if (!budget) {
      budget = { credit: WRITER_BURST, lastSeq: this.opSeq };
      this.writerBudgets.set(writer, budget);
    } else {
      const earned = (this.opSeq - budget.lastSeq - 1) * CREDITS_PER_OTHER_OP;
      budget.credit = Math.min(WRITER_BURST, budget.credit + earned);
      budget.lastSeq = this.opSeq;
    }
    if (budget.credit <= 0) {
      this.flaggedWriters.add(writer);
      return false;
    }
    budget.credit -= 1;
    return true;
  }

  /** `writer` is the appending device's autobase writer key (hex) — absent
   *   when replaying pre-envelope ops from legacy spaces. */
  apply(op: Op, writer?: string): void {
    // Rate bound: an over-budget writer's ops stay in the log (retained) but
    // never materialize (inert). Pre-envelope legacy ops carry no writer and
    // predate the budget.
    if (writer !== undefined && !this.chargeWriter(writer)) return;
    switch (op.t) {
      case 'add-writer':
        break; // writer management happens at the autobase level

      case 'space':
        this.spaceName = op.name;
        break;
      case 'identity':
        if (!this.roots.has(op.userId)) this.roots.set(op.userId, op.rootKey);
        // The first identity minted in the space is its owner.
        if (this.ownerUserId === null) this.ownerUserId = op.userId;
        break;
      case 'device': {
        const root = this.roots.get(op.userId);
        if (!root || this.revokedDevices.has(op.deviceKey) || this.evicted.has(op.userId)) break;
        if (!verifySig(deviceBindingMessage(op.userId, op.deviceKey, op.encPubKey), op.sig, root)) break;
        this.deviceOwners.set(op.deviceKey, op.userId);
        // Record the enc key only when the root signature covered it.
        if (op.encPubKey) this.deviceEncKeys.set(op.deviceKey, op.encPubKey);
        break;
      }
      case 'device-revoke': {
        const root = this.roots.get(op.userId);
        if (!root) break;
        if (!verifySig(deviceRevokeMessage(op.userId, op.deviceKey), op.sig, root)) break;
        this.deviceOwners.delete(op.deviceKey);
        this.revokedDevices.add(op.deviceKey);
        break;
      }
      case 'role': {
        // Only the owner grants/revokes admin. Authorized by the actor's root
        // signature, not the appending device — same model as evict below.
        const root = this.roots.get(op.actorId);
        if (!root || op.actorId !== this.ownerUserId) break;
        if (!verifySig(roleMessage(op.userId, op.role, op.on), op.sig, root)) break;
        if (op.on) this.admins.add(op.userId);
        else this.admins.delete(op.userId);
        break;
      }
      case 'evict': {
        // Authorized by the actor's root signature alone (not the appending
        // device): who holds a manager's root speaks for that manager. Sticky,
        // so a replayed op is a no-op.
        const root = this.roots.get(op.actorId);
        if (!root || !this.canManage(op.actorId)) break;
        if (op.userId === this.ownerUserId) break; // the owner can't be evicted
        if (!verifySig(evictMessage(op.userId), op.sig, root)) break;
        this.evicted.add(op.userId);
        this.admins.delete(op.userId);
        // Revoke every device the evicted user holds and drop their memberships.
        for (const [deviceKey, ownerId] of [...this.deviceOwners]) {
          if (ownerId === op.userId) {
            this.deviceOwners.delete(deviceKey);
            this.revokedDevices.add(deviceKey);
          }
        }
        for (const set of this.members.values()) set.delete(op.userId);
        break;
      }
      case 'setting': {
        const root = this.roots.get(op.actorId);
        if (!root) break;
        if (!verifySig(settingMessage(op.key, op.value), op.sig, root)) break;
        // history is a privacy control (owner-only); name/description are
        // identity a manager (owner or admin) can edit.
        if (op.key === 'historyVisibility') {
          if (op.actorId !== this.ownerUserId) break;
          if (op.value === 'full' || op.value === 'join-forward') this.historyVisibility = op.value;
        } else if (op.key === 'name') {
          if (!this.canManage(op.actorId) || !op.value) break;
          this.spaceName = op.value;
        } else if (op.key === 'description') {
          if (!this.canManage(op.actorId)) break;
          this.spaceDescription = op.value || null;
        }
        break;
      }
      case 'logo': {
        const root = this.roots.get(op.actorId);
        if (!root || !this.canManage(op.actorId)) break;
        if (!verifySig(logoMessage(op.logo?.hash ?? null), op.sig, root)) break;
        this.spaceLogo = op.logo;
        break;
      }
      case 'epoch': {
        // Space rotations need a manager; a channel's members may rotate their
        // own channel. Authorized by the actor's root signature, which also
        // binds the wraps — a copied op with altered wraps fails verification.
        const root = this.roots.get(op.actorId);
        if (!root || !this.mayRotate(op.actorId, op.domain)) break;
        if (!verifySig(epochMessage(op.domain, op.keyId, op.seq, wrapsHash(op.wraps)), op.sig, root)) break;
        const chain = this.epochsFor(op.domain);
        // First write of a keyId wins; replays after a reorder are no-ops.
        if (!chain.has(op.keyId)) chain.set(op.keyId, { seq: op.seq, keyId: op.keyId, wraps: { ...op.wraps } });
        break;
      }
      case 'grant': {
        // Unsigned but self-verifying (recipient checks hash === keyId). Never
        // hand a key to a revoked/evicted/out-of-domain device, even from a
        // malicious insider — and never overwrite an existing wrap (griefing).
        if (!this.deviceInDomain(op.deviceKey, op.domain)) break;
        const record = this.domains.get(op.domain)?.get(op.keyId);
        if (!record) break; // unknown key — the epoch that mints it must come first
        if (record.wraps[op.deviceKey] === undefined) record.wraps[op.deviceKey] = op.sealed;
        break;
      }
      case 'invite-rotate': {
        // Only managers roll the invite; highest (seq, publicKey) wins so
        // concurrent rotations converge on every peer.
        const root = this.roots.get(op.actorId);
        if (!root || !this.canManage(op.actorId)) break;
        if (!verifySig(inviteRotateMessage(op.seq, op.publicKey, op.discoveryKey, wrapsHash(op.wraps)), op.sig, root))
          break;
        const cur = this.currentInvite;
        if (!cur || op.seq > cur.seq || (op.seq === cur.seq && op.publicKey > cur.publicKey)) {
          this.currentInvite = {
            seq: op.seq,
            publicKey: op.publicKey,
            discoveryKey: op.discoveryKey,
            wraps: { ...op.wraps },
          };
        }
        break;
      }
      case 'user': {
        const current = this.users.get(op.id) ?? defaultUser(op.id);
        this.users.set(op.id, { ...current, ...op.patch, id: op.id });
        break;
      }
      case 'channel':
        if (!this.channels.has(op.channel.id)) this.channels.set(op.channel.id, op.channel);
        break;
      case 'archive': {
        const channel = this.channels.get(op.channelId);
        if (channel) channel.archivedAt = op.archived ? op.at : null;
        break;
      }
      case 'member':
        this.memberSet(op.channelId).add(op.userId);
        break;
      case 'unmember':
        this.memberSet(op.channelId).delete(op.userId);
        break;
      case 'msg': {
        if (this.messages.has(op.message.id)) break;
        // Authorship check: the claimed author must own the appending device.
        const verified = writer === undefined ? undefined : this.deviceOwners.get(writer) === op.message.authorId;
        this.messages.set(op.message.id, { ...op.message, verified });
        this.messagesByChannel.set(op.message.channelId, [
          ...(this.messagesByChannel.get(op.message.channelId) ?? []),
          op.message.id,
        ]);
        break;
      }
      case 'att': {
        this.attachments.set(op.attachment.id, op.attachment);
        this.attachmentsByMessage.set(op.attachment.messageId, [
          ...(this.attachmentsByMessage.get(op.attachment.messageId) ?? []),
          op.attachment,
        ]);
        break;
      }
      case 'react': {
        let set = this.reactions.get(op.messageId);
        if (!set) {
          set = new Map();
          this.reactions.set(op.messageId, set);
        }
        const key = `${op.userId}:${op.emoji}`;
        if (op.on) set.set(key, true);
        else set.delete(key);
        break;
      }
      case 'read':
        this.reads.set(`${op.userId}:${op.channelId}`, op.at);
        break;
      case 'block': {
        let set = this.blocks.get(op.userId);
        if (!set) {
          set = new Set();
          this.blocks.set(op.userId, set);
        }
        if (op.on) set.add(op.blockedId);
        else set.delete(op.blockedId);
        break;
      }
      case 'pin': {
        let map = this.pins.get(op.userId);
        if (!map) {
          map = new Map();
          this.pins.set(op.userId, map);
        }
        if (op.on) {
          if (!map.has(op.channelId)) map.set(op.channelId, Math.max(-1, ...map.values()) + 1);
        } else map.delete(op.channelId);
        break;
      }
      case 'pins': {
        const map = this.pins.get(op.userId);
        if (!map) break;
        op.channelIds.forEach((id, position) => {
          if (map.has(id)) map.set(id, position);
        });
        break;
      }
      case 'sched':
        this.scheduled.set(op.scheduled.id, op.scheduled);
        break;
      case 'unsched':
        this.scheduled.delete(op.id);
        break;
      case 'doc': {
        // Whole-doc last-write-wins: concurrent edits converge on the newest
        // save everywhere, and a removed doc never comes back.
        if (this.removedDocs.has(op.doc.id)) break;
        const current = this.docs.get(op.doc.id);
        if (!current || op.doc.updatedAt >= current.updatedAt) this.docs.set(op.doc.id, op.doc);
        break;
      }
      case 'doc-remove':
        this.docs.delete(op.docId);
        this.removedDocs.add(op.docId);
        break;
    }
  }
}
