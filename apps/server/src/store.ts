import { and, asc, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import type { ChannelDto, MessageDto } from '@app/shared';
import { db } from './db/client.js';
import { channelMembers, channels, messages, users } from './db/schema.js';

/**
 * ACL rule (v0): public channels are readable by everyone in the workspace;
 * private channels and DMs only by their members. Everything that returns
 * message content must go through canReadChannel.
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
  const memberships = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  const memberIds = memberships.map((m) => m.channelId);

  const rows = await db.select().from(channels).orderBy(asc(channels.name));
  const visible = rows.filter((c) => c.type === 'public' || memberIds.includes(c.id));

  const dmIds = visible.filter((c) => c.type === 'dm').map((c) => c.id);
  const partnerNames = new Map<string, string[]>();
  if (dmIds.length > 0) {
    const partners = await db
      .select({ channelId: channelMembers.channelId, name: users.name, userId: users.id })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(inArray(channelMembers.channelId, dmIds));
    for (const p of partners) {
      if (p.userId === userId) continue;
      partnerNames.set(p.channelId, [...(partnerNames.get(p.channelId) ?? []), p.name]);
    }
  }

  return visible.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    topic: c.topic,
    ...(c.type === 'dm' ? { dmPartnerNames: partnerNames.get(c.id) ?? [] } : {}),
  }));
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
  row: typeof messages.$inferSelect & { authorName: string },
  replyCount: number,
): MessageDto {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: row.authorName,
    parentMessageId: row.parentMessageId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    replyCount,
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
};

/** Top-level messages of a channel, oldest first. Caller must check ACL. */
export async function listChannelMessages(channelId: string): Promise<MessageDto[]> {
  const rows = await db
    .select(authorJoin)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.channelId, channelId), isNull(messages.parentMessageId)))
    .orderBy(asc(messages.createdAt));
  const counts = await replyCounts(rows.map((r) => r.id));
  return rows.map((r) => toDto(r, counts.get(r.id) ?? 0));
}

/** A thread: the root message plus replies, oldest first. Caller must check ACL. */
export async function getThread(rootId: string): Promise<MessageDto[] | null> {
  const rows = await db
    .select(authorJoin)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(raw`${messages.id} = ${rootId} or ${messages.parentMessageId} = ${rootId}`)
    .orderBy(asc(messages.createdAt));
  if (rows.length === 0) return null;
  return rows.map((r, i) => toDto(r, i === 0 ? rows.length - 1 : 0));
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
    .returning();
  if (!row) throw new Error('insert returned no row');
  const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.authorId));
  return toDto({ ...row, authorName: author?.name ?? 'Unknown' }, 0);
}

export async function listUsers() {
  return db.select({ id: users.id, handle: users.handle, name: users.name }).from(users).orderBy(asc(users.name));
}

export async function getUserByHandle(handle: string) {
  const [row] = await db.select().from(users).where(eq(users.handle, handle));
  return row ?? null;
}

export async function getUserById(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}
