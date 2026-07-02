import { and, asc, eq, gt, inArray, isNull, ne, or, sql as raw } from 'drizzle-orm';
import type { ChannelDto, MessageDto, ProfilePatch, ReactionDto, UserDto } from '@app/shared';
import { db } from './db/client.js';
import { channelMembers, channelReads, channels, messages, reactions, users } from './db/schema.js';

/**
 * ACL rule (v0): public channels are readable by everyone in the workspace;
 * private channels and DMs only by their members. Everything that returns
 * message content must go through canReadChannel (or visibleChannelIds for
 * bulk queries like search).
 */
export async function canReadChannel(userId: string, channelId: string): Promise<boolean> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return false;
  if (channel.type === 'public') return true;
  const [member] = await db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
  return member !== undefined;
}

/** Every channel id the user may read — the bulk-query counterpart of canReadChannel. */
export async function visibleChannelIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: channels.id })
    .from(channels)
    .leftJoin(
      channelMembers,
      and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)),
    )
    .where(raw`${channels.type} = 'public' or ${channelMembers.userId} is not null`);
  return rows.map((r) => r.id);
}

/** User ids allowed to see a channel's messages, or 'all' for public channels. */
export async function channelAudience(channelId: string): Promise<'all' | string[]> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return [];
  if (channel.type === 'public') return 'all';
  const members = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  return members.map((m) => m.userId);
}

export async function visibleChannels(userId: string): Promise<ChannelDto[]> {
  const ids = await visibleChannelIds(userId);
  if (ids.length === 0) return [];
  const rows = await db.select().from(channels).where(inArray(channels.id, ids)).orderBy(asc(channels.name));

  // Unread = messages by others since my read marker (never read → everything counts).
  const unreadRows = await db
    .select({ channelId: messages.channelId, count: raw<number>`count(*)::int` })
    .from(messages)
    .leftJoin(
      channelReads,
      and(eq(channelReads.channelId, messages.channelId), eq(channelReads.userId, userId)),
    )
    .where(
      and(
        inArray(messages.channelId, ids),
        ne(messages.authorId, userId),
        or(isNull(channelReads.lastReadAt), gt(messages.createdAt, channelReads.lastReadAt)),
      ),
    )
    .groupBy(messages.channelId);
  const unread = new Map(unreadRows.map((r) => [r.channelId, r.count]));

  const dmIds = rows.filter((c) => c.type === 'dm').map((c) => c.id);
  const partners = new Map<string, { id: string; name: string }[]>();
  if (dmIds.length > 0) {
    const rows2 = await db
      .select({ channelId: channelMembers.channelId, name: users.name, userId: users.id })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(inArray(channelMembers.channelId, dmIds));
    for (const p of rows2) {
      if (p.userId === userId) continue;
      partners.set(p.channelId, [...(partners.get(p.channelId) ?? []), { id: p.userId, name: p.name }]);
    }
  }

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    topic: c.topic,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    unreadCount: unread.get(c.id) ?? 0,
    ...(c.type === 'dm'
      ? {
          dmPartnerNames: (partners.get(c.id) ?? []).map((p) => p.name),
          dmPartnerIds: (partners.get(c.id) ?? []).map((p) => p.id),
        }
      : {}),
  }));
}

export async function getChannel(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row ?? null;
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
  const [existing] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.name, name), ne(channels.type, 'dm'), isNull(channels.archivedAt)));
  if (existing) return 'name-taken';
  const [row] = await db
    .insert(channels)
    .values({ name, type: input.type, topic: input.topic ?? null })
    .returning({ id: channels.id });
  if (input.type === 'private') {
    await db.insert(channelMembers).values({ channelId: row!.id, userId: creatorId });
  }
  return { id: row!.id };
}

export async function setChannelArchived(channelId: string, archived: boolean): Promise<void> {
  await db
    .update(channels)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(channels.id, channelId));
}

export async function markChannelRead(userId: string, channelId: string): Promise<void> {
  await db
    .insert(channelReads)
    .values({ channelId, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [channelReads.channelId, channelReads.userId],
      set: { lastReadAt: new Date() },
    });
}


/** Toggle a reaction; returns whether it is now present. Caller must check ACL. */
export async function toggleReaction(userId: string, messageId: string, emoji: string): Promise<boolean> {
  const deleted = await db
    .delete(reactions)
    .where(and(eq(reactions.messageId, messageId), eq(reactions.userId, userId), eq(reactions.emoji, emoji)))
    .returning();
  if (deleted.length > 0) return false;
  await db.insert(reactions).values({ messageId, userId, emoji });
  return true;
}

async function reactionsFor(messageIds: string[], viewerId: string): Promise<Map<string, ReactionDto[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      messageId: reactions.messageId,
      emoji: reactions.emoji,
      count: raw<number>`count(*)::int`,
      mine: raw<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
    })
    .from(reactions)
    .where(inArray(reactions.messageId, messageIds))
    .groupBy(reactions.messageId, reactions.emoji);
  const map = new Map<string, ReactionDto[]>();
  for (const r of rows) {
    map.set(r.messageId, [...(map.get(r.messageId) ?? []), { emoji: r.emoji, count: r.count, mine: r.mine }]);
  }
  return map;
}

async function replyCounts(rootIds: string[]): Promise<Map<string, number>> {
  if (rootIds.length === 0) return new Map();
  const rows = await db
    .select({ parentId: messages.parentMessageId, count: raw<number>`count(*)::int` })
    .from(messages)
    .where(inArray(messages.parentMessageId, rootIds))
    .groupBy(messages.parentMessageId);
  return new Map(rows.map((r) => [r.parentId as string, r.count]));
}

function toDto(
  row: {
    id: string;
    channelId: string;
    authorId: string;
    parentMessageId: string | null;
    body: string;
    createdAt: Date;
    authorName: string;
    authorAvatarEmoji: string | null;
  },
  replyCount: number,
  msgReactions: ReactionDto[],
): MessageDto {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorAvatarEmoji: row.authorAvatarEmoji,
    parentMessageId: row.parentMessageId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    replyCount,
    reactions: msgReactions,
  };
}

const authorJoin = {
  id: messages.id,
  channelId: messages.channelId,
  authorId: messages.authorId,
  parentMessageId: messages.parentMessageId,
  body: messages.body,
  createdAt: messages.createdAt,
  authorName: users.name,
  authorAvatarEmoji: users.avatarEmoji,
};

/** Top-level messages of a channel, oldest first. Caller must check ACL. */
export async function listChannelMessages(channelId: string, viewerId: string): Promise<MessageDto[]> {
  const rows = await db
    .select(authorJoin)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.channelId, channelId), isNull(messages.parentMessageId)))
    .orderBy(asc(messages.createdAt));
  const ids = rows.map((r) => r.id);
  const [counts, reacts] = await Promise.all([replyCounts(ids), reactionsFor(ids, viewerId)]);
  return rows.map((r) => toDto(r, counts.get(r.id) ?? 0, reacts.get(r.id) ?? []));
}

/** A thread: the root message plus replies, oldest first. Caller must check ACL. */
export async function getThread(rootId: string, viewerId: string): Promise<MessageDto[] | null> {
  const rows = await db
    .select(authorJoin)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(raw`${messages.id} = ${rootId} or ${messages.parentMessageId} = ${rootId}`)
    .orderBy(asc(messages.createdAt));
  if (rows.length === 0) return null;
  const reacts = await reactionsFor(rows.map((r) => r.id), viewerId);
  return rows.map((r, i) => toDto(r, i === 0 ? rows.length - 1 : 0, reacts.get(r.id) ?? []));
}

export async function getMessage(id: string): Promise<{ channelId: string } | null> {
  const [row] = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, id));
  return row ?? null;
}

export async function createMessage(input: {
  channelId: string;
  authorId: string;
  body: string;
  parentMessageId?: string | null;
}): Promise<MessageDto> {
  const [row] = await db
    .insert(messages)
    .values({
      channelId: input.channelId,
      authorId: input.authorId,
      body: input.body,
      parentMessageId: input.parentMessageId ?? null,
    })
    .returning({
      id: messages.id,
      channelId: messages.channelId,
      authorId: messages.authorId,
      parentMessageId: messages.parentMessageId,
      body: messages.body,
      createdAt: messages.createdAt,
    });
  if (!row) throw new Error('insert returned no row');
  const [author] = await db
    .select({ name: users.name, avatarEmoji: users.avatarEmoji })
    .from(users)
    .where(eq(users.id, input.authorId));
  return toDto(
    { ...row, authorName: author?.name ?? 'Unknown', authorAvatarEmoji: author?.avatarEmoji ?? null },
    0,
    [],
  );
}

/** A status past its expiry reads as no status — the sweep nulls it for real. */
const statusExpired = raw<boolean>`(${users.statusExpiresAt} is not null and ${users.statusExpiresAt} < now())`;

const userColumns = {
  id: users.id,
  handle: users.handle,
  name: users.name,
  title: users.title,
  team: users.team,
  avatarEmoji: users.avatarEmoji,
  statusEmoji: raw<string | null>`case when ${statusExpired} then null else ${users.statusEmoji} end`,
  statusText: raw<string | null>`case when ${statusExpired} then null else ${users.statusText} end`,
};

export async function listUsers(): Promise<UserDto[]> {
  return db.select(userColumns).from(users).orderBy(asc(users.name));
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<UserDto> {
  const { statusExpiresInMinutes, ...fields } = patch;
  const [row] = await db
    .update(users)
    .set({
      ...fields,
      statusExpiresAt:
        statusExpiresInMinutes == null ? null : new Date(Date.now() + statusExpiresInMinutes * 60_000),
    })
    .where(eq(users.id, userId))
    .returning(userColumns);
  if (!row) throw new Error('no such user');
  return row;
}

/** Null out expired statuses; returns the users that changed (for fan-out). */
export async function clearExpiredStatuses(): Promise<UserDto[]> {
  return db
    .update(users)
    .set({ statusEmoji: null, statusText: null, statusExpiresAt: null })
    .where(and(raw`${users.statusExpiresAt} is not null`, raw`${users.statusExpiresAt} < now()`))
    .returning(userColumns);
}

/**
 * Find the group conversation with exactly these members (order-independent),
 * creating it on first use — same reuse semantics as 1:1 DMs.
 */
export async function getOrCreateGroup(creatorId: string, otherUserIds: string[]): Promise<string> {
  const memberIds = [...new Set([creatorId, ...otherUserIds])].sort();
  const rows = await db.execute(raw`
    select c.id from channels c
    where c.type = 'dm'
      and (select count(*) from channel_members m where m.channel_id = c.id) = ${memberIds.length}
      and (select count(*) from channel_members m
           where m.channel_id = c.id
             and m.user_id in (${raw.join(memberIds.map((id) => raw`${id}::uuid`), raw`, `)})) = ${memberIds.length}
    limit 1`);
  const existing = rows[0] as { id: string } | undefined;
  if (existing) return existing.id;

  const members = await db.select({ handle: users.handle }).from(users).where(inArray(users.id, memberIds));
  if (members.length !== memberIds.length) throw new Error('unknown user in group');
  const [group] = await db
    .insert(channels)
    .values({ name: `group-${members.map((m) => m.handle).join('-')}`, type: 'dm', topic: null })
    .returning({ id: channels.id });
  await db.insert(channelMembers).values(memberIds.map((userId) => ({ channelId: group!.id, userId })));
  return group!.id;
}

export async function getUserByHandle(handle: string) {
  const [row] = await db.select().from(users).where(eq(users.handle, handle));
  return row ?? null;
}

export async function getUserById(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}
