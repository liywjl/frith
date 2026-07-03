import { and, asc, desc, eq, gt, inArray, isNull, isNotNull, ne, or, sql as raw } from 'drizzle-orm';
import type {
  ChannelDto,
  ConnectDto,
  HomeDto,
  MessageDto,
  ProfilePageDto,
  ProfilePatch,
  ReactionDto,
  UserDto,
} from '@app/shared';
import { db } from './db/client.js';
import { channelMembers, channelReads, channels, messages, reactions, users } from './db/schema.js';
import { extractArtifacts } from './artifacts.js';

/** Reactions + replies a message has drawn — the "engagement" score. */
const engagement = raw`(
  (select count(*) from reactions r where r.message_id = ${messages.id})
  + (select count(*) from messages x where x.parent_message_id = ${messages.id})
)`;

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
  interests: users.interests,
  nowPlaying: users.nowPlaying,
};

export async function listUsers(): Promise<UserDto[]> {
  return db.select(userColumns).from(users).orderBy(asc(users.name));
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<UserDto> {
  const { statusExpiresInMinutes, ...fields } = patch;
  const set: Record<string, unknown> = { ...fields };
  // Only touch the expiry when the caller explicitly set/cleared the timer —
  // an unrelated patch must not silently cancel a running status timer.
  if (statusExpiresInMinutes !== undefined) {
    set.statusExpiresAt =
      statusExpiresInMinutes === null ? null : new Date(Date.now() + statusExpiresInMinutes * 60_000);
  }
  const [row] = await db.update(users).set(set).where(eq(users.id, userId)).returning(userColumns);
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

/**
 * Productivity profile: what has this person been working on, where, and how
 * much — computed from channels the *viewer* can read. DM content is excluded
 * entirely, even when the viewer is the DM partner: profiles summarize public
 * work, never private conversations.
 */
export async function getProfilePage(viewerId: string, targetId: string): Promise<ProfilePageDto | null> {
  const [target] = await db.select(userColumns).from(users).where(eq(users.id, targetId));
  if (!target) return null;

  const visible = await visibleChannelIds(viewerId);
  const scope =
    visible.length === 0
      ? []
      : (
          await db
            .select({ id: channels.id })
            .from(channels)
            .where(and(inArray(channels.id, visible), ne(channels.type, 'dm')))
        ).map((c) => c.id);

  const teammates = target.team
    ? await db.select(userColumns).from(users).where(eq(users.team, target.team)).orderBy(asc(users.name))
    : [];

  if (scope.length === 0) {
    return {
      user: target,
      stats: { messages: 0, reactionsReceived: 0, channelsActive: 0 },
      topChannels: [],
      teammates,
      popular: [],
      artifacts: [],
      recent: [],
    };
  }

  const authored = and(eq(messages.authorId, targetId), inArray(messages.channelId, scope));

  const [stats] = await db
    .select({
      messages: raw<number>`count(*)::int`,
      channelsActive: raw<number>`count(distinct ${messages.channelId})::int`,
    })
    .from(messages)
    .where(authored);

  const [received] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(reactions)
    .innerJoin(messages, eq(messages.id, reactions.messageId))
    .where(authored);

  const topChannels = await db
    .select({ id: channels.id, name: channels.name, count: raw<number>`count(*)::int` })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(authored)
    .groupBy(channels.id, channels.name)
    .orderBy(desc(raw`count(*)`))
    .limit(5);

  const recentRows = await db
    .select(authorJoin)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(authored)
    .orderBy(desc(messages.createdAt))
    .limit(5);

  const popularRows = await db
    .select(authorJoin)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(and(authored, raw`${engagement} > 0`))
    .orderBy(desc(engagement))
    .limit(3);

  const bodies = await db
    .select({ body: messages.body, channelId: messages.channelId, channelName: channels.name })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(authored)
    .orderBy(desc(messages.createdAt))
    .limit(150);

  const ids = [...new Set([...recentRows, ...popularRows].map((r) => r.id))];
  const [counts, reacts] = await Promise.all([replyCounts(ids), reactionsFor(ids, viewerId)]);
  const dto = (r: (typeof recentRows)[number]) => toDto(r, counts.get(r.id) ?? 0, reacts.get(r.id) ?? []);

  return {
    user: target,
    stats: {
      messages: stats?.messages ?? 0,
      reactionsReceived: received?.count ?? 0,
      channelsActive: stats?.channelsActive ?? 0,
    },
    topChannels,
    teammates,
    popular: popularRows.map(dto),
    artifacts: extractArtifacts(bodies, 6),
    recent: recentRows.map(dto),
  };
}

/**
 * The social matcher, v0: deterministic interest overlap. People who share
 * your interests, and interests where enough of you overlap that a group
 * is worth starting. An embedding model later upgrades matching from exact
 * tags to "vinyl ≈ record collecting" — the response shape stays the same.
 */
export async function connectSuggestions(userId: string): Promise<ConnectDto> {
  const all = await listUsers();
  const me = all.find((u) => u.id === userId);
  if (!me || me.interests.length === 0) return { people: [], groups: [] };

  const mine = new Map(me.interests.map((i) => [i.toLowerCase(), i]));
  const others = all.filter((u) => u.id !== userId);

  const people = others
    .map((u) => ({
      user: u,
      sharedInterests: u.interests.filter((i) => mine.has(i.toLowerCase())),
    }))
    .filter((p) => p.sharedInterests.length > 0)
    .sort((a, b) => b.sharedInterests.length - a.sharedInterests.length)
    .slice(0, 5);

  const groups = [];
  for (const [key, label] of mine) {
    const members = others.filter((u) => u.interests.some((i) => i.toLowerCase() === key));
    if (members.length < 2) continue; // a "group" of you and one other is just a DM
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.name, slug), ne(channels.type, 'dm'), isNull(channels.archivedAt)));
    groups.push({ interest: label, members, existingChannelId: existing?.id ?? null });
  }
  groups.sort((a, b) => b.members.length - a.members.length);

  return { people, groups: groups.slice(0, 4) };
}

/** The Home digest: unread conversations and live threads you're part of. */
export async function getHome(userId: string): Promise<HomeDto> {
  const chans = await visibleChannels(userId);
  const unreadChans = chans.filter((c) => c.unreadCount > 0 && !c.archivedAt).slice(0, 8);

  const unread = [];
  for (const c of unreadChans) {
    const [latest] = await db
      .select({ body: messages.body, createdAt: messages.createdAt, authorName: users.name })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(eq(messages.channelId, c.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (!latest) continue;
    unread.push({
      channelId: c.id,
      name: c.name,
      type: c.type,
      unreadCount: c.unreadCount,
      ...(c.type === 'dm' ? { dmPartnerNames: c.dmPartnerNames } : {}),
      latestAuthor: latest.authorName,
      latestSnippet: latest.body.length > 120 ? `${latest.body.slice(0, 120)}…` : latest.body,
      latestAt: latest.createdAt.toISOString(),
    });
  }

  // Threads I'm in (authored the root or replied), ranked by latest reply.
  const visible = chans.map((c) => c.id);
  const threads: HomeDto['threads'] = [];
  if (visible.length > 0) {
    const myRoots = await db
      .selectDistinct({ rootId: raw<string>`coalesce(${messages.parentMessageId}, ${messages.id})` })
      .from(messages)
      .where(and(eq(messages.authorId, userId), inArray(messages.channelId, visible)));
    const rootIds = myRoots.map((r) => r.rootId);
    if (rootIds.length > 0) {
      const active = await db
        .select({
          rootId: messages.parentMessageId,
          replyCount: raw<number>`count(*)::int`,
          lastReplyAt: raw<Date>`max(${messages.createdAt})`,
        })
        .from(messages)
        .where(and(inArray(messages.parentMessageId, rootIds), isNotNull(messages.parentMessageId)))
        .groupBy(messages.parentMessageId)
        .orderBy(desc(raw`max(${messages.createdAt})`))
        .limit(6);

      for (const t of active) {
        const rootId = t.rootId as string;
        const [root] = await db
          .select({ body: messages.body, channelId: messages.channelId, authorName: users.name, channelName: channels.name })
          .from(messages)
          .innerJoin(users, eq(users.id, messages.authorId))
          .innerJoin(channels, eq(channels.id, messages.channelId))
          .where(eq(messages.id, rootId));
        const [lastReply] = await db
          .select({ authorName: users.name })
          .from(messages)
          .innerJoin(users, eq(users.id, messages.authorId))
          .where(eq(messages.parentMessageId, rootId))
          .orderBy(desc(messages.createdAt))
          .limit(1);
        if (!root) continue;
        threads.push({
          rootId,
          channelId: root.channelId,
          channelName: root.channelName,
          rootAuthorName: root.authorName,
          rootSnippet: root.body.length > 120 ? `${root.body.slice(0, 120)}…` : root.body,
          replyCount: t.replyCount,
          lastReplyAt: new Date(t.lastReplyAt).toISOString(),
          lastReplyAuthor: lastReply?.authorName ?? root.authorName,
        });
      }
    }
  }

  // Popular threads across everything visible (and not archived).
  const activeIds = chans.filter((c) => !c.archivedAt).map((c) => c.id);
  const popular: HomeDto['popular'] = [];
  if (activeIds.length > 0) {
    const rows = await db
      .select({
        rootId: messages.id,
        channelId: messages.channelId,
        channelName: channels.name,
        authorName: users.name,
        body: messages.body,
        replyCount: raw<number>`(select count(*) from messages x where x.parent_message_id = ${messages.id})::int`,
        reactionCount: raw<number>`(select count(*) from reactions r where r.message_id = ${messages.id})::int`,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(isNull(messages.parentMessageId), inArray(messages.channelId, activeIds), raw`${engagement} > 0`))
      .orderBy(desc(engagement))
      .limit(3);
    for (const r of rows) {
      popular.push({
        rootId: r.rootId,
        channelId: r.channelId,
        channelName: r.channelName,
        authorName: r.authorName,
        snippet: r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body,
        replyCount: r.replyCount,
        reactionCount: r.reactionCount,
      });
    }
  }

  return { unread, threads, popular };
}

export async function getUserByHandle(handle: string) {
  const [row] = await db.select().from(users).where(eq(users.handle, handle));
  return row ?? null;
}

export async function getUserById(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}
