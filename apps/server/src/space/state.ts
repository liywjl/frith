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
/** Manager-signed space logo change; null clears it. The signature covers the
 *  whole record, not just the bytes' hash: `mime` decides the content-type the
 *  public logo route serves, and `key`/`id` decide which bytes are served at
 *  all, so a replayed op with those swapped must not verify. */
export const logoMessage = (logo: SpaceLogo | null) =>
  logo === null
    ? 'frith:logo:none'
    : `frith:logo:${logo.hash}:${logo.mime}:${logo.key}:${logo.id.blockOffset}:${logo.id.blockLength}:${logo.id.byteOffset}:${logo.id.byteLength}`;

/** What the logo route may serve. Uploads are sniffed (`effectiveMime`), so
 *  this only has to stop a hand-crafted op naming a scriptable type — an SVG
 *  on the app's own origin is a script, and the route is public. */
const LOGO_MIME = /^image\/(png|jpeg|gif|webp)$/;

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
/** The same bounding, in bytes. Ops are not all one size: the HTTP edge caps
 *  bodies (10 KB messages, 200 KB docs), but a peer appending straight to the
 *  log is bound by nothing, so 4096 ops can still be gigabytes of other
 *  people's disk. Byte credit accrues on the same clock as op credit. */
export const WRITER_BYTE_BURST = 32 * 1024 * 1024;
export const BYTES_PER_OTHER_OP = 256 * 1024;

/** What an op costs an honest peer to hold. JSON is what the log stores, so
 *  its length is the honest measure — and identical on every peer. */
const opBytes = (op: Op): number => JSON.stringify(op).length;

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
  /** device (writer) key → the users it is bound to, for bindings that
   *  verified. Usually one. A device that holds several root seeds — dev's
   *  many-profiles-one-machine setup, or a second identity imported onto your
   *  laptop — legitimately speaks for each of them, and the reducer has to be
   *  able to say so or it would call honest ops forgeries. */
  deviceOwners = new Map<string, Set<string>>();
  /** The reverse index: userId → its bound devices. An identity nobody's
   *  device is bound to cannot be spoken for, so it also cannot be spoofed. */
  private userDevices = new Map<string, Set<string>>();
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
  /** channelId → the users the creating device spoke for. A channel's founder
   *  curates it before it has any members. */
  channelCreators = new Map<string, Set<string>>();
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
  /** writer key → banked op/byte credit and the clock reading at their last op. */
  private writerBudgets = new Map<string, { credit: number; bytes: number; lastSeq: number }>();
  /** Writers that ran over budget — their excess ops were skipped as inert. */
  flaggedWriters = new Set<string>();
  /** Writers admitted by a revoked or tainted writer. Autobase admits whoever
   *  an `add-writer` op names, so without this an evicted node could mint
   *  itself a fresh, apparently-clean writer key and carry on appending. */
  taintedWriters = new Set<string>();

  memberSet(channelId: string): Set<string> {
    let set = this.members.get(channelId);
    if (!set) {
      set = new Set();
      this.members.set(channelId, set);
    }
    return set;
  }

  /** Record / drop a verified device binding, both directions. */
  private bindDevice(deviceKey: string, userId: string): void {
    if (!this.deviceOwners.has(deviceKey)) this.deviceOwners.set(deviceKey, new Set());
    this.deviceOwners.get(deviceKey)!.add(userId);
    if (!this.userDevices.has(userId)) this.userDevices.set(userId, new Set());
    this.userDevices.get(userId)!.add(deviceKey);
  }

  /** Unbind one user from a device, or (no userId) the device entirely. */
  private unbindDevice(deviceKey: string, userId?: string): void {
    const owners = this.deviceOwners.get(deviceKey);
    if (!owners) return;
    for (const owner of userId === undefined ? [...owners] : [userId]) {
      owners.delete(owner);
      const devices = this.userDevices.get(owner);
      devices?.delete(deviceKey);
      if (devices?.size === 0) this.userDevices.delete(owner);
    }
    if (owners.size === 0) this.deviceOwners.delete(deviceKey);
  }

  /** The users an appending writer may speak for: identities bound to that
   *  device that hold a known root and are still in the space. */
  private actorsOf(writer: string): string[] {
    const out: string[] = [];
    for (const userId of this.deviceOwners.get(writer) ?? []) {
      if (this.roots.has(userId) && !this.evicted.has(userId)) out.push(userId);
    }
    return out;
  }

  /** A writer whose appends must not change state: its device binding was
   *  revoked (theft, eviction), or a revoked writer admitted it. */
  private inert(writer: string): boolean {
    return this.revokedDevices.has(writer) || this.taintedWriters.has(writer);
  }

  /** Is this identity spoken for by some device? Only then is there anything
   *  to impersonate — a dev-seeded user with no root and no device is nobody's
   *  to steal, and enforcing over it would freeze dev's whole cast. It is also
   *  what says whether anyone else's device will act on their behalf. */
  hasBoundDevice(userId: string): boolean {
    return (this.userDevices.get(userId)?.size ?? 0) > 0;
  }

  /**
   * May the appending writer make this change? (HARDENING §10.)
   *
   * Identity and membership-control ops carry their own root signatures.
   * Content ops don't — they are authorized by WHO APPENDED them, and the
   * verdict has to come from the log alone so every peer reaches it
   * identically. Three layers, in order:
   *
   *  1. A revoked or tainted writer authors nothing. This is what makes
   *     eviction bite before §2's log rotation lands: the evicted node keeps
   *     replicating, but its appends stop changing honest peers' state.
   *  2. `subject` is the identity the op acts as or upon. If nobody's device
   *     is bound to it, it is not claimable and the op applies as before —
   *     this is the same "authorship is unknowable here" case §5 resolved for
   *     `verified`, and it keeps dev's one-writer-many-users setup working.
   *  3. Otherwise the writer must speak for someone `allow` accepts.
   *
   * Ops with no identity subject (`null`) skip layer 2: a writer that speaks
   * for nobody is ungoverned, one that speaks for someone is held to it.
   * Pre-envelope ops (no writer at all) are grandfathered — legacy spaces
   * predate attribution.
   */
  private permits(writer: string | undefined, subject: string | null, allow: (actor: string) => boolean): boolean {
    if (writer === undefined) return true;
    if (this.inert(writer)) return false;
    if (subject !== null && !this.hasBoundDevice(subject)) return true;
    const actors = this.actorsOf(writer);
    if (actors.length === 0) return subject === null;
    return actors.some(allow);
  }

  /** May this user curate a channel — its roster and its archived state?
   *  Its members and its founder, plus space managers. */
  private mayCurate(actor: string, channelId: string): boolean {
    return (
      this.canManage(actor) ||
      (this.members.get(channelId)?.has(actor) ?? false) ||
      (this.channelCreators.get(channelId)?.has(actor) ?? false)
    );
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
    // `inert`, not just revoked: a device key an evicted node minted for
    // itself must not be sealed into a domain either, or eviction is undone by
    // one add-writer op and a fresh identity.
    if (this.inert(deviceKey)) return false;
    const owners = [...(this.deviceOwners.get(deviceKey) ?? [])].filter((id) => !this.evicted.has(id));
    if (owners.length === 0) return false;
    if (domain === 'space') return true;
    const members = this.members.get(domain.slice('channel:'.length));
    return owners.some((id) => members?.has(id) ?? false);
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

  /** Spend one op's worth of credit — one op and its bytes — for `writer`.
   *  False means the writer is over budget: flag it and leave the op inert. */
  private chargeWriter(writer: string, bytes: number): boolean {
    this.opSeq += 1;
    let budget = this.writerBudgets.get(writer);
    if (!budget) {
      budget = { credit: WRITER_BURST, bytes: WRITER_BYTE_BURST, lastSeq: this.opSeq };
      this.writerBudgets.set(writer, budget);
    } else {
      const others = this.opSeq - budget.lastSeq - 1;
      budget.credit = Math.min(WRITER_BURST, budget.credit + others * CREDITS_PER_OTHER_OP);
      budget.bytes = Math.min(WRITER_BYTE_BURST, budget.bytes + others * BYTES_PER_OTHER_OP);
      budget.lastSeq = this.opSeq;
    }
    if (budget.credit <= 0 || budget.bytes < bytes) {
      this.flaggedWriters.add(writer);
      return false;
    }
    budget.credit -= 1;
    budget.bytes -= bytes;
    return true;
  }

  /** `writer` is the appending device's autobase writer key (hex) — absent
   *   when replaying pre-envelope ops from legacy spaces. */
  apply(op: Op, writer?: string): void {
    // Rate bound: an over-budget writer's ops stay in the log (retained) but
    // never materialize (inert). Pre-envelope legacy ops carry no writer and
    // predate the budget.
    if (writer !== undefined && !this.chargeWriter(writer, opBytes(op))) return;
    switch (op.t) {
      case 'add-writer':
        // Writer management happens at the autobase level; the reducer only
        // tracks provenance, so a writer admitted by an inert one inherits it.
        if (writer !== undefined && this.inert(writer)) this.taintedWriters.add(op.key);
        break;

      case 'space':
        // Founding only — first write wins. Renames travel as manager-signed
        // `setting` ops, so this unsigned op must not be a way around them.
        if (this.spaceName === null) this.spaceName = op.name;
        break;
      case 'identity':
        if (!this.roots.has(op.userId)) this.roots.set(op.userId, op.rootKey);
        // The first identity minted in the space is its owner.
        if (this.ownerUserId === null) this.ownerUserId = op.userId;
        break;
      case 'device': {
        const root = this.roots.get(op.userId);
        // A tainted key never becomes anyone's device — an evicted node must
        // not be able to launder itself back in behind a fresh identity.
        if (!root || this.inert(op.deviceKey) || this.evicted.has(op.userId)) break;
        if (!verifySig(deviceBindingMessage(op.userId, op.deviceKey, op.encPubKey), op.sig, root)) break;
        this.bindDevice(op.deviceKey, op.userId);
        // Record the enc key only when the root signature covered it.
        if (op.encPubKey) this.deviceEncKeys.set(op.deviceKey, op.encPubKey);
        break;
      }
      case 'device-revoke': {
        const root = this.roots.get(op.userId);
        if (!root) break;
        if (!verifySig(deviceRevokeMessage(op.userId, op.deviceKey), op.sig, root)) break;
        // A revoked device key is compromised as a key: every binding on it
        // goes, not just the revoking user's.
        this.unbindDevice(op.deviceKey);
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
        // Unbind the evicted user from every device, and revoke outright the
        // ones that were theirs alone. A device another identity still holds
        // (dev's shared machine) keeps working for that identity — revoking it
        // would evict a bystander.
        for (const [deviceKey, owners] of [...this.deviceOwners]) {
          if (!owners.has(op.userId)) continue;
          this.unbindDevice(deviceKey, op.userId);
          if (!this.deviceOwners.has(deviceKey)) this.revokedDevices.add(deviceKey);
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
        if (!verifySig(logoMessage(op.logo), op.sig, root)) break;
        if (op.logo && !LOGO_MIME.test(op.logo.mime)) break;
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
        if (writer !== undefined && this.inert(writer)) break;
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
        // Your profile is yours: name, bio, and links can only be rewritten by
        // a device that speaks for you.
        if (!this.permits(writer, op.id, (actor) => actor === op.id)) break;
        const current = this.users.get(op.id) ?? defaultUser(op.id);
        this.users.set(op.id, { ...current, ...op.patch, id: op.id });
        break;
      }
      case 'channel': {
        if (this.channels.has(op.channel.id)) break;
        if (!this.permits(writer, null, () => true)) break;
        this.channels.set(op.channel.id, op.channel);
        // Remember the founder — they curate the roster before it has members.
        const founders = writer === undefined ? [] : this.actorsOf(writer);
        if (founders.length > 0) this.channelCreators.set(op.channel.id, new Set(founders));
        break;
      }
      case 'archive': {
        const channel = this.channels.get(op.channelId);
        if (!channel) break;
        // A public channel is space-wide, so freezing one is a manager action;
        // a private channel belongs to its members. Mirrors the HTTP edge.
        const mayArchive = (actor: string) =>
          channel.type === 'public' ? this.canManage(actor) : this.mayCurate(actor, op.channelId);
        if (!this.permits(writer, null, mayArchive)) break;
        channel.archivedAt = op.archived ? op.at : null;
        break;
      }
      case 'member': {
        // The one place "flag, don't reject" (§5) would be wrong: key
        // eligibility follows membership automatically, so an applied forged
        // `member` op makes honest peers seal the channel's content keys — the
        // whole keychain under the default historyVisibility — to the forger.
        const roster = this.memberSet(op.channelId);
        const mayAdd = (actor: string) =>
          this.mayCurate(actor, op.channelId) || (roster.size === 0 && actor === op.userId);
        if (!this.permits(writer, op.userId, mayAdd)) break;
        roster.add(op.userId);
        break;
      }
      case 'unmember': {
        // Members curate the roster; anyone may remove themself (leaving).
        const mayRemove = (actor: string) => actor === op.userId || this.mayCurate(actor, op.channelId);
        if (!this.permits(writer, op.userId, mayRemove)) break;
        this.memberSet(op.channelId).delete(op.userId);
        break;
      }
      case 'msg': {
        if (this.messages.has(op.message.id)) break;
        const { authorId } = op.message;
        if (!this.permits(writer, authorId, (actor) => actor === authorId)) break;
        // Authorship check: the claimed author must own the appending device.
        // What survives the guard above and still fails here is the unknowable
        // case (an author no device is bound to) — flagged, not rejected (§5).
        const verified = writer === undefined ? undefined : this.actorsOf(writer).includes(authorId);
        this.messages.set(op.message.id, { ...op.message, verified });
        this.messagesByChannel.set(op.message.channelId, [
          ...(this.messagesByChannel.get(op.message.channelId) ?? []),
          op.message.id,
        ]);
        break;
      }
      case 'att': {
        // First write wins — nobody swaps the bytes under a file someone else
        // already shared. The att op lands before its message, so the author
        // is usually not knowable yet; when it is, it has to match.
        if (this.attachments.has(op.attachment.id)) break;
        const authorId = this.messages.get(op.attachment.messageId)?.authorId ?? null;
        if (!this.permits(writer, authorId, (actor) => authorId === null || actor === authorId)) break;
        this.attachments.set(op.attachment.id, op.attachment);
        this.attachmentsByMessage.set(op.attachment.messageId, [
          ...(this.attachmentsByMessage.get(op.attachment.messageId) ?? []),
          op.attachment,
        ]);
        break;
      }
      case 'react': {
        if (!this.permits(writer, op.userId, (actor) => actor === op.userId)) break;
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
        if (!this.permits(writer, op.userId, (actor) => actor === op.userId)) break;
        this.reads.set(`${op.userId}:${op.channelId}`, op.at);
        break;
      case 'block': {
        if (!this.permits(writer, op.userId, (actor) => actor === op.userId)) break;
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
        if (!this.permits(writer, op.userId, (actor) => actor === op.userId)) break;
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
        if (!this.permits(writer, op.userId, (actor) => actor === op.userId)) break;
        const map = this.pins.get(op.userId);
        if (!map) break;
        op.channelIds.forEach((id, position) => {
          if (map.has(id)) map.set(id, position);
        });
        break;
      }
      case 'sched': {
        const { authorId } = op.scheduled;
        if (!this.permits(writer, authorId, (actor) => actor === authorId)) break;
        this.scheduled.set(op.scheduled.id, op.scheduled);
        break;
      }
      case 'unsched': {
        // Cancelling or delivering someone else's pending message is theirs
        // alone; an unknown id is a stale replay and stays a no-op.
        const authorId = this.scheduled.get(op.id)?.authorId ?? null;
        if (!this.permits(writer, authorId, (actor) => authorId === null || actor === authorId)) break;
        this.scheduled.delete(op.id);
        break;
      }
      case 'doc': {
        // Whole-doc last-write-wins: concurrent edits converge on the newest
        // save everywhere, and a removed doc never comes back.
        if (this.removedDocs.has(op.doc.id)) break;
        // Docs are the space's shared pages — anyone may edit one, but only as
        // themselves; the byline has to match the device that wrote it.
        const { updatedBy } = op.doc;
        if (!this.permits(writer, updatedBy, (actor) => actor === updatedBy)) break;
        const current = this.docs.get(op.doc.id);
        if (!current || op.doc.updatedAt >= current.updatedAt) this.docs.set(op.doc.id, op.doc);
        break;
      }
      case 'doc-remove': {
        // Removal is sticky (a reordered stale edit must not resurrect a doc),
        // which is exactly why it can't be open to everyone.
        const createdBy = this.docs.get(op.docId)?.createdBy ?? null;
        const mayRemove = (actor: string) => createdBy === null || actor === createdBy || this.canManage(actor);
        if (!this.permits(writer, createdBy, mayRemove)) break;
        this.docs.delete(op.docId);
        this.removedDocs.add(op.docId);
        break;
      }
    }
  }
}
