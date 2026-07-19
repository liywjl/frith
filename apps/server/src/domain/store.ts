// Frith's data access layer, backed by the space's Autobase log (see
// data/space.ts). Reads come from materialized in-memory state; every write
// appends an op that all peers apply identically. The function surface is
// unchanged from the Postgres era — routes and tests didn't have to care.
import crypto from 'node:crypto';
import type {
  DocDto,
  DocFullDto,
  AttachmentDto,
  FileDto,
  ChannelDto,
  ConnectDto,
  FeedDto,
  FeedItemDto,
  FeedLinkDto,
  HomeDto,
  MeDto,
  MessageDto,
  ProfilePageDto,
  ProfilePatch,
  ReactionDto,
  ScheduledMessageDto,
  UserDto,
} from '@app/shared';
import { space } from '../space/space.js';
import type { AttachmentRow, DocRow, MessageRow, UserRow } from '../space/state.js';
import { isDangerousName } from './files.js';

export { parseInvite } from '../space/space.js';

const state = () => space.state;

/* ------------------------------- users -------------------------------- */

function statusVisible(user: UserRow): { statusEmoji: string | null; statusText: string | null } {
  const expired = user.statusExpiresAt !== null && new Date(user.statusExpiresAt) < new Date();
  return {
    statusEmoji: expired ? null : user.statusEmoji,
    statusText: expired ? null : user.statusText,
  };
}

function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    title: user.title,
    team: user.team,
    avatarEmoji: user.avatarEmoji,
    ...statusVisible(user),
    interests: user.interests,
    nowPlaying: user.nowPlaying,
    bio: user.bio,
    links: user.links,
    accentColor: user.accentColor,
    location: user.location,
  };
}

export async function listUsers(): Promise<UserDto[]> {
  return [...state().users.values()].map(toUserDto).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUserByHandle(handle: string) {
  return [...state().users.values()].find((u) => u.handle === handle) ?? null;
}

export async function getUserById(id: string) {
  return state().users.get(id) ?? null;
}

/** The signed-in user's own view: profile + settings, expiry-aware. */
export async function getMe(userId: string): Promise<MeDto> {
  const me = state().users.get(userId);
  if (!me) throw new Error('no such user');
  const expired = me.statusExpiresAt !== null && new Date(me.statusExpiresAt) < new Date();
  return {
    ...toUserDto(me),
    theme: me.theme as MeDto['theme'],
    statusExpiresAt: expired ? null : me.statusExpiresAt,
    blockedUserIds: await blockedIds(userId),
  };
}

export async function createUser(handle: string, name: string): Promise<UserRow> {
  const existing = await getUserByHandle(handle);
  if (existing) return existing;
  const id = space.newId();
  await space.append({ t: 'user', id, patch: { handle, name } });
  return state().users.get(id)!;
}

/** A brand-new person in this space — the real onboarding path. */
export async function createProfile(input: {
  name: string;
  handle: string;
  avatarEmoji?: string | null;
}): Promise<UserRow | 'handle-taken' | 'invalid-handle'> {
  const handle = input.handle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '')
    .slice(0, 30);
  if (!handle) return 'invalid-handle';
  if (await getUserByHandle(handle)) return 'handle-taken';
  const id = space.newId();
  await space.append({
    t: 'user',
    id,
    patch: { handle, name: input.name.trim(), avatarEmoji: input.avatarEmoji ?? null },
  });
  // A new person gets a root identity, and this device becomes its first
  // certified device. Dev-seeded users skip this — nothing enforces yet.
  await space.bindLocalDevice(id, crypto.randomBytes(32).toString('hex'));
  return state().users.get(id)!;
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<UserDto> {
  const user = state().users.get(userId);
  if (!user) throw new Error('no such user');
  const { statusExpiresInMinutes, ...fields } = patch;
  const full: Partial<UserRow> = { ...fields, handle: user.handle, name: patch.name ?? user.name };
  // Date the change so the feed can show "currently enjoying" updates.
  if (patch.nowPlaying !== undefined && patch.nowPlaying !== user.nowPlaying) {
    full.nowPlayingAt = patch.nowPlaying ? new Date().toISOString() : null;
  }
  // Only touch the expiry when the caller explicitly set/cleared the timer.
  if (statusExpiresInMinutes !== undefined) {
    full.statusExpiresAt =
      statusExpiresInMinutes === null
        ? null
        : new Date(Date.now() + statusExpiresInMinutes * 60_000).toISOString();
  }
  await space.append({ t: 'user', id: userId, patch: full as Partial<UserRow> & Pick<UserRow, 'handle' | 'name'> });
  return toUserDto(state().users.get(userId)!);
}

/** Null out expired statuses; returns the users that changed (for fan-out). */
export async function clearExpiredStatuses(): Promise<UserDto[]> {
  const now = new Date();
  const cleared: UserDto[] = [];
  for (const user of state().users.values()) {
    if (user.statusExpiresAt !== null && new Date(user.statusExpiresAt) < now) {
      await space.append({
        t: 'user',
        id: user.id,
        patch: { handle: user.handle, name: user.name, statusEmoji: null, statusText: null, statusExpiresAt: null },
      });
      cleared.push(toUserDto(state().users.get(user.id)!));
    }
  }
  return cleared;
}

/* ------------------------------ channels ------------------------------ */

export async function getChannel(id: string) {
  const channel = state().channels.get(id);
  return channel ? { ...channel, archivedAt: channel.archivedAt ? new Date(channel.archivedAt) : null } : null;
}

export async function canReadChannel(userId: string, channelId: string): Promise<boolean> {
  const channel = state().channels.get(channelId);
  if (!channel) return false;
  if (channel.type === 'public') return true;
  return state().members.get(channelId)?.has(userId) ?? false;
}

async function visibleChannelIds(userId: string): Promise<string[]> {
  return [...state().channels.values()]
    .filter((c) => c.type === 'public' || state().members.get(c.id)?.has(userId))
    .map((c) => c.id);
}

export async function channelAudience(channelId: string): Promise<'all' | string[]> {
  const channel = state().channels.get(channelId);
  if (!channel) return [];
  if (channel.type === 'public') return 'all';
  return [...(state().members.get(channelId) ?? [])];
}

function unreadCount(userId: string, channelId: string): number {
  const lastRead = state().reads.get(`${userId}:${channelId}`);
  const ids = state().messagesByChannel.get(channelId) ?? [];
  let count = 0;
  for (const id of ids) {
    const m = state().messages.get(id)!;
    if (m.authorId !== userId && (!lastRead || m.createdAt > lastRead)) count += 1;
  }
  return count;
}

function lastActivityAt(channelId: string): string | null {
  const ids = state().messagesByChannel.get(channelId) ?? [];
  let latest: string | null = null;
  for (const id of ids) {
    const at = state().messages.get(id)!.createdAt;
    if (!latest || at > latest) latest = at;
  }
  return latest;
}

function dmPartners(channelId: string, userId: string): UserRow[] {
  return [...(state().members.get(channelId) ?? [])]
    .filter((id) => id !== userId)
    .map((id) => state().users.get(id))
    .filter((u): u is UserRow => u !== undefined);
}

export async function visibleChannels(userId: string): Promise<ChannelDto[]> {
  const ids = await visibleChannelIds(userId);
  const pinnedBy = state().pins.get(userId);
  return ids
    .map((id) => state().channels.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      topic: c.topic,
      archivedAt: c.archivedAt,
      pinned: pinnedBy?.get(c.id) ?? null,
      unreadCount: unreadCount(userId, c.id),
      lastActivityAt: lastActivityAt(c.id),
      ...(c.type === 'dm'
        ? {
            dmPartnerNames: dmPartners(c.id, userId).map((p) => p.name),
            dmPartnerIds: dmPartners(c.id, userId).map((p) => p.id),
          }
        : {}),
    }));
}

export async function markChannelRead(userId: string, channelId: string): Promise<void> {
  await space.append({ t: 'read', userId, channelId, at: new Date().toISOString() });
}

/** Slack-style channel names: lowercase, dashes, nothing weird. */
function normalizeChannelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function createChannel(
  creatorId: string,
  input: { name: string; type: 'public' | 'private'; topic?: string | null },
): Promise<{ id: string } | 'invalid-name' | 'name-taken'> {
  const name = normalizeChannelName(input.name);
  if (!name) return 'invalid-name';
  const taken = [...state().channels.values()].some(
    (c) => c.name === name && c.type !== 'dm' && c.archivedAt === null,
  );
  if (taken) return 'name-taken';
  const id = space.newId();
  await space.append({
    t: 'channel',
    channel: { id, name, type: input.type, topic: input.topic ?? null, archivedAt: null },
  });
  if (input.type === 'private') {
    await space.append({ t: 'member', channelId: id, userId: creatorId });
    // A private channel gets its own content keychain from birth, so removing
    // a member later locks exactly this channel.
    await space.ensureDomainKey(space.contentDomain('private', id), creatorId);
  }
  return { id };
}

export async function setChannelArchived(channelId: string, archived: boolean): Promise<void> {
  await space.append({ t: 'archive', channelId, archived, at: new Date().toISOString() });
}

/* ----------------------- membership (private/dm) ----------------------- */

export async function listChannelMembers(channelId: string): Promise<UserDto[]> {
  return [...(state().members.get(channelId) ?? [])]
    .map((id) => state().users.get(id))
    .filter((u): u is UserRow => u !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toUserDto);
}

/** Add someone to a private channel or group — members only invite. */
export async function addChannelMember(channelId: string, userId: string): Promise<'ok' | 'no-user' | 'public'> {
  const channel = state().channels.get(channelId);
  if (!channel || channel.type === 'public') return 'public'; // everyone is already in
  if (!state().users.has(userId)) return 'no-user';
  if (!state().members.get(channelId)?.has(userId)) {
    await space.append({ t: 'member', channelId, userId });
    await space.reconcile(); // seal the channel's keys to their devices now
  }
  return 'ok';
}

/** Remove someone (or yourself — leaving) from a private channel or group. */
export async function removeChannelMember(channelId: string, userId: string): Promise<'ok' | 'public'> {
  const channel = state().channels.get(channelId);
  if (!channel || channel.type === 'public') return 'public';
  if (state().members.get(channelId)?.has(userId)) {
    await space.append({ t: 'unmember', channelId, userId });
    // Rotate the channel's content key away from them, if this device may.
    // (Remote peers do the same via their own reconcile when the op arrives.)
    await space.reconcile();
  }
  return 'ok';
}

export async function getOrCreateGroup(creatorId: string, otherUserIds: string[]): Promise<string> {
  const memberIds = [...new Set([creatorId, ...otherUserIds])].sort();
  for (const [id, members] of state().members) {
    const channel = state().channels.get(id);
    if (channel?.type !== 'dm') continue;
    if (members.size === memberIds.length && memberIds.every((m) => members.has(m))) return id;
  }
  if (memberIds.some((id) => !state().users.has(id))) throw new Error('unknown user in group');
  const id = space.newId();
  const handles = memberIds.map((m) => state().users.get(m)!.handle).join('-');
  await space.append({
    t: 'channel',
    channel: { id, name: `group-${handles}`, type: 'dm', topic: null, archivedAt: null },
  });
  for (const userId of memberIds) await space.append({ t: 'member', channelId: id, userId });
  await space.ensureDomainKey(space.contentDomain('dm', id), creatorId);
  return id;
}

/* ------------------------------ messages ------------------------------ */

/** The content-key domain a channel's messages/files encrypt under. */
function domainOf(channelId: string) {
  const channel = state().channels.get(channelId);
  return space.contentDomain(channel?.type ?? 'public', channelId);
}

/** A message's plaintext for search/snippets/previews — '' when this device
 *  lacks the content key, so locked messages never leak into derived views. */
export function clearBody(m: MessageRow): string {
  return space.decryptBody(m.body) ?? '';
}

const snippet = (text: string, max = 120): string => (text.length > max ? `${text.slice(0, max)}…` : text);

function reactionsFor(messageId: string, viewerId: string): ReactionDto[] {
  const set = state().reactions.get(messageId);
  if (!set) return [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const key of set.keys()) {
    const [userId, emoji] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const entry = byEmoji.get(emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (userId === viewerId) entry.mine = true;
    byEmoji.set(emoji, entry);
  }
  return [...byEmoji.entries()].map(([emoji, e]) => ({ emoji, count: e.count, mine: e.mine }));
}

function attachmentKind(mime: string): AttachmentDto['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function toAttachmentDto(a: AttachmentRow): AttachmentDto {
  const name = space.decryptBody(a.name) ?? 'Encrypted file';
  return {
    id: a.id,
    kind: attachmentKind(a.mime),
    name,
    url: `/api/files/${a.id}`,
    size: a.size,
    mime: a.mime,
    dangerous: isDangerousName(name),
    // Pre-blob attachments have bytes only on the uploader's disk; report
    // them cached so they render as a plain link (a peer's GET just 404s).
    cached: a.blob ? space.blobs.isCachedSync(a.blob) : true,
  };
}

function attachmentDtos(messageId: string): AttachmentDto[] {
  return (state().attachmentsByMessage.get(messageId) ?? []).map(toAttachmentDto);
}

function replyCount(messageId: string): number {
  const m = state().messages.get(messageId);
  if (!m) return 0;
  return (state().messagesByChannel.get(m.channelId) ?? []).filter(
    (id) => state().messages.get(id)!.parentMessageId === messageId,
  ).length;
}

export function toMessageDto(row: MessageRow, viewerId: string): MessageDto {
  const author = state().users.get(row.authorId);
  // Decrypt with the content key we hold; null means we were removed before
  // this was sent (or never had the key) — show a lock, not a crash.
  const clear = space.decryptBody(row.body);
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: author?.name ?? 'Unknown',
    authorAvatarEmoji: author?.avatarEmoji ?? null,
    parentMessageId: row.parentMessageId,
    body: clear ?? 'This message is unavailable — you no longer have access to it.',
    createdAt: row.createdAt,
    replyCount: replyCount(row.id),
    reactions: reactionsFor(row.id, viewerId),
    attachments: attachmentDtos(row.id),
    ...(clear === null ? { locked: true } : {}),
  };
}

export async function blockedIds(viewerId: string): Promise<string[]> {
  return [...(state().blocks.get(viewerId) ?? [])];
}

/** Has `viewerId` blocked `authorId`? Synchronous — for per-recipient fan-out
 *  filtering, where reads already drop blocked authors (see channelMessages). */
export function hasBlocked(viewerId: string, authorId: string): boolean {
  return state().blocks.get(viewerId)?.has(authorId) ?? false;
}

export async function setBlocked(viewerId: string, targetId: string, blocked: boolean): Promise<string[]> {
  await space.append({ t: 'block', userId: viewerId, blockedId: targetId, on: blocked });
  return blockedIds(viewerId);
}

function channelMessages(channelId: string, viewerId: string): MessageRow[] {
  const blocked = state().blocks.get(viewerId);
  return (state().messagesByChannel.get(channelId) ?? [])
    .map((id) => state().messages.get(id)!)
    .filter((m) => !blocked?.has(m.authorId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listChannelMessages(channelId: string, viewerId: string): Promise<MessageDto[]> {
  return channelMessages(channelId, viewerId)
    .filter((m) => m.parentMessageId === null)
    .map((m) => toMessageDto(m, viewerId));
}

export async function getThread(rootId: string, viewerId: string): Promise<MessageDto[] | null> {
  const root = state().messages.get(rootId);
  if (!root) return null;
  return channelMessages(root.channelId, viewerId)
    .filter((m) => m.id === rootId || m.parentMessageId === rootId)
    .map((m) => toMessageDto(m, viewerId));
}

export async function getMessage(id: string): Promise<{ channelId: string; authorId: string } | null> {
  const m = state().messages.get(id);
  return m ? { channelId: m.channelId, authorId: m.authorId } : null;
}

export async function createMessage(input: {
  id?: string;
  channelId: string;
  authorId: string;
  body: string;
  parentMessageId?: string | null;
}): Promise<MessageDto> {
  // Public channels encrypt under the space key; private channels and DMs
  // under their own — so removal locks exactly the right scope. Pre-existing
  // channels mint their key on first write. Plaintext fallback keeps
  // pre-encryption spaces working.
  const domain = domainOf(input.channelId);
  await space.ensureDomainKey(domain, input.authorId);
  const message: MessageRow = {
    id: input.id ?? space.newId(),
    channelId: input.channelId,
    authorId: input.authorId,
    parentMessageId: input.parentMessageId ?? null,
    body: space.encryptBody(domain, input.body),
    createdAt: new Date().toISOString(),
  };
  await space.append({ t: 'msg', message });
  return toMessageDto(message, input.authorId);
}

export async function toggleReaction(userId: string, messageId: string, emoji: string): Promise<boolean> {
  const on = !state().reactions.get(messageId)?.has(`${userId}:${emoji}`);
  await space.append({ t: 'react', messageId, userId, emoji, on });
  return on;
}

/* ---------------------------- attachments ----------------------------- */

/** Store the bytes in this instance's blob core, then append the metadata op.
 *  Takes the channel explicitly — the attachment op lands before its message. */
export async function addAttachment(messageId: string, channelId: string, name: string, mime: string, bytes: Buffer) {
  // Filename and bytes both encrypt under the channel's domain key; the blob
  // hash covers the sealed envelope so peer verification still holds.
  const domain = domainOf(channelId);
  const { ref, hash } = await space.blobs.put(space.encryptBytes(domain, bytes));
  const attachment: AttachmentRow = {
    id: space.newId(),
    messageId,
    name: space.encryptBody(domain, name),
    mime,
    size: bytes.length, // plaintext size — what the UI shows
    hash,
    blob: ref,
  };
  await space.append({ t: 'att', attachment });
  return attachment;
}

export async function getAttachment(id: string) {
  const attachment = state().attachments.get(id);
  if (!attachment) return null;
  const message = state().messages.get(attachment.messageId);
  if (!message) return null;
  // Decrypt the filename for Content-Disposition / danger checks.
  const name = space.decryptBody(attachment.name) ?? 'encrypted-file';
  return { ...attachment, name, channelId: message.channelId, authorId: message.authorId };
}

/** Everything shared in channels the viewer can read — attachment + context. */
export function filesVisibleTo(viewerId: string): (AttachmentRow & { message: MessageRow })[] {
  const visible = visibleChannelSet(viewerId);
  const blocked = state().blocks.get(viewerId);
  return [...state().attachments.values()]
    .map((a) => ({ ...a, message: state().messages.get(a.messageId) }))
    .filter((a): a is AttachmentRow & { message: MessageRow } => {
      return a.message !== undefined && visible.has(a.message.channelId) && !blocked?.has(a.message.authorId);
    });
}

function toFileDto(a: AttachmentRow & { message: MessageRow }): FileDto {
  return {
    ...toAttachmentDto(a),
    messageId: a.messageId,
    channelId: a.message.channelId,
    channelName: state().channels.get(a.message.channelId)?.name ?? 'unknown',
    authorName: state().users.get(a.message.authorId)?.name ?? 'Unknown',
    createdAt: a.message.createdAt,
  };
}

export async function listFiles(viewerId: string): Promise<FileDto[]> {
  return filesVisibleTo(viewerId)
    .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt))
    .map(toFileDto);
}

/* ----------------------------- shared docs ----------------------------- */

function toDocDto(doc: DocRow): DocDto {
  return {
    id: doc.id,
    title: space.decryptBody(doc.title) ?? '(locked)',
    createdBy: doc.createdBy,
    updatedAt: doc.updatedAt,
    updatedByName: state().users.get(doc.updatedBy)?.name ?? 'Unknown',
  };
}

export async function listDocs(): Promise<DocDto[]> {
  return [...state().docs.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toDocDto);
}

export async function getDoc(docId: string): Promise<DocFullDto | null> {
  const doc = state().docs.get(docId);
  if (!doc) return null;
  return { ...toDocDto(doc), body: space.decryptBody(doc.body) ?? '' };
}

/** Docs are space-wide pages; title and body seal under the space key. */
export async function createDoc(authorId: string, title: string): Promise<DocFullDto> {
  await space.ensureDomainKey('space', authorId);
  const doc: DocRow = {
    id: space.newId(),
    title: space.encryptBody('space', title),
    body: space.encryptBody('space', ''),
    createdBy: authorId,
    updatedBy: authorId,
    updatedAt: new Date().toISOString(),
  };
  await space.append({ t: 'doc', doc });
  return { ...toDocDto(doc), body: '' };
}

export async function updateDoc(
  userId: string,
  docId: string,
  patch: { title?: string; body?: string },
): Promise<DocFullDto | null> {
  const current = state().docs.get(docId);
  if (!current) return null;
  const doc: DocRow = {
    ...current,
    title: patch.title !== undefined ? space.encryptBody('space', patch.title) : current.title,
    body: patch.body !== undefined ? space.encryptBody('space', patch.body) : current.body,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
  await space.append({ t: 'doc', doc });
  return getDoc(docId);
}

/** Remove a doc — only its creator or a space manager may. */
export async function removeDoc(requesterId: string, docId: string): Promise<'ok' | 'no-doc' | 'forbidden'> {
  const doc = state().docs.get(docId);
  if (!doc) return 'no-doc';
  if (doc.createdBy !== requesterId && !space.canManage(requesterId)) return 'forbidden';
  await space.append({ t: 'doc-remove', docId });
  return 'ok';
}

/* ------------------------- pins & scheduling -------------------------- */

export async function setPinned(userId: string, channelId: string, pinned: boolean): Promise<void> {
  await space.append({ t: 'pin', userId, channelId, on: pinned });
}

export async function reorderPins(userId: string, channelIds: string[]): Promise<void> {
  await space.append({ t: 'pins', userId, channelIds });
}

function toScheduledDto(row: { id: string; channelId: string; body: string; sendAt: string }): ScheduledMessageDto {
  // Scheduled bodies are encrypted in the log like sent messages.
  return { id: row.id, channelId: row.channelId, body: space.decryptBody(row.body) ?? '', sendAt: row.sendAt };
}

export async function scheduleMessage(input: {
  authorId: string;
  channelId: string;
  body: string;
  sendAt: Date;
  parentMessageId?: string | null;
}): Promise<ScheduledMessageDto> {
  const domain = domainOf(input.channelId);
  await space.ensureDomainKey(domain, input.authorId);
  const scheduled = {
    id: space.newId(),
    channelId: input.channelId,
    authorId: input.authorId,
    parentMessageId: input.parentMessageId ?? null,
    // A pending message is still message content — never plaintext in the log.
    body: space.encryptBody(domain, input.body),
    sendAt: input.sendAt.toISOString(),
  };
  await space.append({ t: 'sched', scheduled });
  return toScheduledDto(scheduled);
}

export async function listScheduled(authorId: string): Promise<ScheduledMessageDto[]> {
  return [...state().scheduled.values()]
    .filter((s) => s.authorId === authorId)
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
    .map(toScheduledDto);
}

export async function cancelScheduled(authorId: string, id: string): Promise<boolean> {
  const row = state().scheduled.get(id);
  if (!row || row.authorId !== authorId) return false;
  await space.append({ t: 'unsched', id });
  return true;
}

export async function claimDueScheduled() {
  const now = new Date().toISOString();
  const due = [...state().scheduled.values()].filter((s) => s.sendAt <= now);
  for (const item of due) await space.append({ t: 'unsched', id: item.id });
  return due.map((d) => ({ ...d, parentMessageId: d.parentMessageId }));
}

/* --------------------------- social surfaces --------------------------- */

export async function connectSuggestions(userId: string): Promise<ConnectDto> {
  const me = state().users.get(userId);
  if (!me || me.interests.length === 0) return { people: [], groups: [] };

  const blocked = state().blocks.get(userId);
  const mine = new Map(me.interests.map((i) => [i.toLowerCase(), i]));
  const others = [...state().users.values()].filter((u) => u.id !== userId && !blocked?.has(u.id));

  const people = others
    .map((u) => ({
      user: toUserDto(u),
      sharedInterests: u.interests.filter((i) => mine.has(i.toLowerCase())),
    }))
    .filter((p) => p.sharedInterests.length > 0)
    .sort((a, b) => b.sharedInterests.length - a.sharedInterests.length)
    .slice(0, 5);

  const groups = [];
  for (const [key, label] of mine) {
    const members = others.filter((u) => u.interests.some((i) => i.toLowerCase() === key));
    if (members.length < 2) continue;
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const existing = [...state().channels.values()].find(
      (c) => c.name === slug && c.type !== 'dm' && c.archivedAt === null,
    );
    groups.push({ interest: label, members: members.map(toUserDto), existingChannelId: existing?.id ?? null });
  }
  groups.sort((a, b) => b.members.length - a.members.length);
  return { people, groups: groups.slice(0, 4) };
}

function nonDmScope(viewerId: string): Set<string> {
  return new Set(
    [...state().channels.values()]
      .filter((c) => c.type !== 'dm' && (c.type === 'public' || state().members.get(c.id)?.has(viewerId)))
      .map((c) => c.id),
  );
}

export async function getProfilePage(viewerId: string, targetId: string): Promise<ProfilePageDto | null> {
  const target = state().users.get(targetId);
  if (!target) return null;

  const teammates = target.team
    ? [...state().users.values()]
        .filter((u) => u.team === target.team)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(toUserDto)
    : [];

  const scope = nonDmScope(viewerId);
  const authored = [...state().messages.values()]
    .filter((m) => m.authorId === targetId && scope.has(m.channelId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const reactionsReceived = authored.reduce((sum, m) => sum + (state().reactions.get(m.id)?.size ?? 0), 0);
  const byChannel = new Map<string, number>();
  for (const m of authored) byChannel.set(m.channelId, (byChannel.get(m.channelId) ?? 0) + 1);
  const topChannels = [...byChannel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, name: state().channels.get(id)!.name, count }));

  const engagement = (m: MessageRow) => (state().reactions.get(m.id)?.size ?? 0) + replyCount(m.id);
  const popular = [...authored]
    .filter((m) => engagement(m) > 0)
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, 3);

  const { extractArtifacts } = await import('./artifacts.js');
  const artifacts = extractArtifacts(
    authored.slice(0, 150).map((m) => ({
      body: clearBody(m),
      channelId: m.channelId,
      channelName: state().channels.get(m.channelId)!.name,
    })),
    6,
  );

  // Their photo wall: images they shared, in channels the viewer can read —
  // and never DMs, even when the viewer is the other half of the DM.
  const photos = filesVisibleTo(viewerId)
    .filter(
      (a) =>
        a.message.authorId === targetId &&
        scope.has(a.message.channelId) &&
        a.mime.startsWith('image/') &&
        !isDangerousName(space.decryptBody(a.name) ?? ''),
    )
    .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt))
    .slice(0, 12)
    .map(toFileDto);

  return {
    user: toUserDto(target),
    stats: {
      messages: authored.length,
      reactionsReceived,
      channelsActive: byChannel.size,
    },
    topChannels,
    teammates,
    popular: popular.map((m) => toMessageDto(m, viewerId)),
    artifacts,
    recent: authored.slice(0, 5).map((m) => toMessageDto(m, viewerId)),
    photos,
  };
}

export async function getHome(userId: string): Promise<HomeDto> {
  const channels = await visibleChannels(userId);
  const unread = [];
  for (const c of channels.filter((ch) => ch.unreadCount > 0 && !ch.archivedAt).slice(0, 8)) {
    const rows = channelMessages(c.id, userId);
    const latest = rows[rows.length - 1];
    if (!latest) continue;
    const author = state().users.get(latest.authorId);
    unread.push({
      channelId: c.id,
      name: c.name,
      type: c.type,
      unreadCount: c.unreadCount,
      ...(c.type === 'dm' ? { dmPartnerNames: c.dmPartnerNames } : {}),
      latestAuthor: author?.name ?? 'Unknown',
      latestSnippet: snippet(clearBody(latest)),
      latestAt: latest.createdAt,
    });
  }

  const visible = new Set(channels.map((c) => c.id));
  const myRoots = new Set<string>();
  for (const m of state().messages.values()) {
    if (m.authorId === userId && visible.has(m.channelId)) myRoots.add(m.parentMessageId ?? m.id);
  }
  const threads = [...myRoots]
    .map((rootId) => {
      const root = state().messages.get(rootId);
      if (!root) return null;
      const replies = (state().messagesByChannel.get(root.channelId) ?? [])
        .map((id) => state().messages.get(id)!)
        .filter((m) => m.parentMessageId === rootId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (replies.length === 0) return null;
      const last = replies[replies.length - 1]!;
      return {
        rootId,
        channelId: root.channelId,
        channelName: state().channels.get(root.channelId)!.name,
        rootAuthorName: state().users.get(root.authorId)?.name ?? 'Unknown',
        rootSnippet: snippet(clearBody(root)),
        replyCount: replies.length,
        lastReplyAt: last.createdAt,
        lastReplyAuthor: state().users.get(last.authorId)?.name ?? 'Unknown',
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => b.lastReplyAt.localeCompare(a.lastReplyAt))
    .slice(0, 6);

  const activeIds = new Set(channels.filter((c) => !c.archivedAt).map((c) => c.id));
  const engagement = (m: MessageRow) => (state().reactions.get(m.id)?.size ?? 0) + replyCount(m.id);
  const popular = [...state().messages.values()]
    .filter((m) => m.parentMessageId === null && activeIds.has(m.channelId) && engagement(m) > 0)
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, 3)
    .map((m) => ({
      rootId: m.id,
      channelId: m.channelId,
      channelName: state().channels.get(m.channelId)!.name,
      authorName: state().users.get(m.authorId)?.name ?? 'Unknown',
      snippet: snippet(clearBody(m)),
      replyCount: replyCount(m.id),
      reactionCount: state().reactions.get(m.id)?.size ?? 0,
    }));

  return { unread, threads, popular };
}

/* ------------------------------- the feed ------------------------------ */

const FEED_CAP = 60;
const FEED_URL_RE = /https?:\/\/[^\s)]+/g;

function feedLink(url: string): FeedLinkDto {
  try {
    return { url, domain: new URL(url).hostname.replace(/^www\./, '') };
  } catch {
    return { url, domain: url };
  }
}

/**
 * The space feed: what people shared, strictly newest-first. No ranking, no
 * engagement weighting — chronology is the whole algorithm, and it ends.
 * Scope mirrors profile pages: channels the viewer may read, never DMs, never
 * archived channels; locked messages decrypt to '' and so contribute nothing.
 * With `authorId` it becomes one person's timeline for their profile page.
 */
export async function getFeed(viewerId: string, authorId?: string): Promise<FeedDto> {
  const scope = nonDmScope(viewerId);
  for (const c of state().channels.values()) if (c.archivedAt) scope.delete(c.id);
  const blocked = state().blocks.get(viewerId);
  const items: FeedItemDto[] = [];

  for (const m of state().messages.values()) {
    // Replies are comments on their post (surfaced as a count), not posts.
    if (m.parentMessageId) continue;
    if (authorId && m.authorId !== authorId) continue;
    if (!scope.has(m.channelId) || blocked?.has(m.authorId)) continue;
    const author = userDtoById(m.authorId);
    if (!author) continue;
    const photos = attachmentDtos(m.id).filter((a) => a.kind === 'image' && !a.dangerous);
    const clear = clearBody(m);
    const urls = [...new Set(clear.match(FEED_URL_RE) ?? [])];
    if (photos.length === 0 && urls.length === 0) continue;
    const base = {
      at: m.createdAt,
      author,
      channelId: m.channelId,
      channelName: state().channels.get(m.channelId)!.name,
      messageId: m.id,
      body: snippet(clear, 200),
      comments: replyCount(m.id),
      reactions: state().reactions.get(m.id)?.size ?? 0,
    };
    // A message with both photos and links shows as photos — the image is the
    // share; its links stay readable in the body text.
    if (photos.length > 0) items.push({ kind: 'photos', id: `photos:${m.id}`, ...base, photos });
    else items.push({ kind: 'links', id: `links:${m.id}`, ...base, links: urls.slice(0, 3).map(feedLink) });
  }

  for (const doc of state().docs.values()) {
    if (authorId && doc.updatedBy !== authorId) continue;
    const author = userDtoById(doc.updatedBy);
    const title = space.decryptBody(doc.title);
    if (!author || title === null) continue;
    items.push({ kind: 'doc', id: `doc:${doc.id}:${doc.updatedAt}`, at: doc.updatedAt, author, docId: doc.id, title });
  }

  for (const u of state().users.values()) {
    if (authorId && u.id !== authorId) continue;
    if (!u.nowPlaying || !u.nowPlayingAt || blocked?.has(u.id)) continue;
    items.push({
      kind: 'enjoying',
      id: `enjoying:${u.id}:${u.nowPlayingAt}`,
      at: u.nowPlayingAt,
      author: toUserDto(u),
      nowPlaying: u.nowPlaying,
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, FEED_CAP) };
}

/* ------------------------------ channels for search ------------------- */

export function channelName(id: string): string {
  return state().channels.get(id)?.name ?? 'unknown';
}

/** Channel ids the viewer may read: public, or private with membership. */
function visibleChannelSet(viewerId: string): Set<string> {
  return new Set(
    [...state().channels.values()]
      .filter((c) => c.type === 'public' || state().members.get(c.id)?.has(viewerId))
      .map((c) => c.id),
  );
}

export function messagesVisibleTo(viewerId: string): MessageRow[] {
  const visible = visibleChannelSet(viewerId);
  const blocked = state().blocks.get(viewerId);
  return [...state().messages.values()].filter(
    (m) => visible.has(m.channelId) && !blocked?.has(m.authorId),
  );
}

export function userDtoById(id: string): UserDto | null {
  const user = state().users.get(id);
  return user ? toUserDto(user) : null;
}

