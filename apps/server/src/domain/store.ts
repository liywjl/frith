// Lore's data access layer, backed by the space's Autobase log (see
// data/space.ts). Reads come from materialized in-memory state; every write
// appends an op that all peers apply identically. The function surface is
// unchanged from the Postgres era — routes and tests didn't have to care.
import type {
  AddonDto,
  AttachmentDto,
  FileDto,
  ChannelDto,
  ConnectDto,
  HomeDto,
  MessageDto,
  ProfilePageDto,
  ProfilePatch,
  ReactionDto,
  ScheduledMessageDto,
  UserDto,
} from '@app/shared';
import { space } from '../space/space.js';
import type { AddonRow, AttachmentRow, MessageRow, UserRow } from '../space/state.js';
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

export async function createUser(handle: string, name: string): Promise<UserRow> {
  const existing = await getUserByHandle(handle);
  if (existing) return existing;
  const id = space.newId();
  await space.append({ t: 'user', id, patch: { handle, name } });
  return state().users.get(id)!;
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<UserDto> {
  const user = state().users.get(userId);
  if (!user) throw new Error('no such user');
  const { statusExpiresInMinutes, ...fields } = patch;
  const full: Partial<UserRow> = { ...fields, handle: user.handle, name: patch.name ?? user.name };
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
  if (input.type === 'private') await space.append({ t: 'member', channelId: id, userId: creatorId });
  return { id };
}

export async function setChannelArchived(channelId: string, archived: boolean): Promise<void> {
  await space.append({ t: 'archive', channelId, archived, at: new Date().toISOString() });
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
  return id;
}

/* ------------------------------ messages ------------------------------ */

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
  return {
    id: a.id,
    kind: attachmentKind(a.mime),
    name: a.name,
    url: `/api/files/${a.id}`,
    size: a.size,
    dangerous: isDangerousName(a.name),
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
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: author?.name ?? 'Unknown',
    authorAvatarEmoji: author?.avatarEmoji ?? null,
    parentMessageId: row.parentMessageId,
    body: row.body,
    createdAt: row.createdAt,
    replyCount: replyCount(row.id),
    reactions: reactionsFor(row.id, viewerId),
    attachments: attachmentDtos(row.id),
  };
}

export async function blockedIds(viewerId: string): Promise<string[]> {
  return [...(state().blocks.get(viewerId) ?? [])];
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

export async function getMessage(id: string): Promise<{ channelId: string } | null> {
  const m = state().messages.get(id);
  return m ? { channelId: m.channelId } : null;
}

export async function createMessage(input: {
  id?: string;
  channelId: string;
  authorId: string;
  body: string;
  parentMessageId?: string | null;
}): Promise<MessageDto> {
  const message: MessageRow = {
    id: input.id ?? space.newId(),
    channelId: input.channelId,
    authorId: input.authorId,
    parentMessageId: input.parentMessageId ?? null,
    body: input.body,
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

/** Store the bytes in this instance's blob core, then append the metadata op. */
export async function addAttachment(messageId: string, name: string, mime: string, bytes: Buffer) {
  const { ref, hash } = await space.blobs.put(bytes);
  const attachment: AttachmentRow = {
    id: space.newId(),
    messageId,
    name,
    mime,
    size: bytes.length,
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
  return { ...attachment, channelId: message.channelId, authorId: message.authorId };
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

export async function listFiles(viewerId: string): Promise<FileDto[]> {
  return filesVisibleTo(viewerId)
    .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt))
    .map((a) => ({
      ...toAttachmentDto(a),
      messageId: a.messageId,
      channelId: a.message.channelId,
      channelName: state().channels.get(a.message.channelId)?.name ?? 'unknown',
      authorName: state().users.get(a.message.authorId)?.name ?? 'Unknown',
      createdAt: a.message.createdAt,
    }));
}

/* ------------------------------- add-ons ------------------------------- */

function toAddonDto(row: AddonRow): AddonDto {
  const items = state().addonItems.get(row.id) ?? [];
  return {
    ...row,
    createdByName: state().users.get(row.createdBy)?.name ?? 'Unknown',
    items: items.map((i) => ({
      id: i.id,
      text: i.text,
      url: i.url,
      done: i.done,
      authorName: state().users.get(i.authorId)?.name ?? 'Unknown',
      createdAt: i.createdAt,
    })),
  };
}

export async function listAddons(): Promise<AddonDto[]> {
  return [...state().addons.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toAddonDto);
}

export async function createAddon(
  creatorId: string,
  input: { name: string; emoji: string; kind: AddonRow['kind'] },
): Promise<AddonDto> {
  const addon: AddonRow = {
    id: space.newId(),
    name: input.name,
    emoji: input.emoji,
    kind: input.kind,
    createdBy: creatorId,
    createdAt: new Date().toISOString(),
  };
  await space.append({ t: 'addon', addon });
  return toAddonDto(addon);
}

export async function removeAddon(addonId: string): Promise<boolean> {
  if (!state().addons.has(addonId)) return false;
  await space.append({ t: 'addon-remove', addonId });
  return true;
}

export async function addAddonItem(
  authorId: string,
  addonId: string,
  input: { text: string; url?: string | null },
): Promise<AddonDto | null> {
  if (!state().addons.has(addonId)) return null;
  await space.append({
    t: 'addon-item',
    item: {
      id: space.newId(),
      addonId,
      authorId,
      text: input.text,
      url: input.url ?? null,
      done: false,
      createdAt: new Date().toISOString(),
    },
  });
  return toAddonDto(state().addons.get(addonId)!);
}

export async function toggleAddonItem(addonId: string, itemId: string, done: boolean): Promise<AddonDto | null> {
  if (!state().addons.has(addonId)) return null;
  await space.append({ t: 'addon-toggle', addonId, itemId, done });
  return toAddonDto(state().addons.get(addonId)!);
}

/* ------------------------- pins & scheduling -------------------------- */

export async function setPinned(userId: string, channelId: string, pinned: boolean): Promise<void> {
  await space.append({ t: 'pin', userId, channelId, on: pinned });
}

export async function reorderPins(userId: string, channelIds: string[]): Promise<void> {
  await space.append({ t: 'pins', userId, channelIds });
}

function toScheduledDto(row: { id: string; channelId: string; body: string; sendAt: string }): ScheduledMessageDto {
  return { id: row.id, channelId: row.channelId, body: row.body, sendAt: row.sendAt };
}

export async function scheduleMessage(input: {
  authorId: string;
  channelId: string;
  body: string;
  sendAt: Date;
  parentMessageId?: string | null;
}): Promise<ScheduledMessageDto> {
  const scheduled = {
    id: space.newId(),
    channelId: input.channelId,
    authorId: input.authorId,
    parentMessageId: input.parentMessageId ?? null,
    body: input.body,
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
      body: m.body,
      channelId: m.channelId,
      channelName: state().channels.get(m.channelId)!.name,
    })),
    6,
  );

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
      latestSnippet: latest.body.length > 120 ? `${latest.body.slice(0, 120)}…` : latest.body,
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
        rootSnippet: root.body.length > 120 ? `${root.body.slice(0, 120)}…` : root.body,
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
      snippet: m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body,
      replyCount: replyCount(m.id),
      reactionCount: state().reactions.get(m.id)?.size ?? 0,
    }));

  return { unread, threads, popular };
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

