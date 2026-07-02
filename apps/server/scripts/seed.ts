import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, sql } from '../src/db/client.js';
import { channelMembers, channelReads, channels, messages, reactions, users } from '../src/db/schema.js';

interface Corpus {
  users: {
    handle: string;
    name: string;
    title?: string | null;
    team?: string | null;
    avatarEmoji?: string | null;
    statusEmoji?: string | null;
    statusText?: string | null;
  }[];
  channels: {
    name: string;
    type: 'public' | 'private' | 'dm';
    topic: string;
    members?: string[];
    archived?: boolean;
  }[];
  messages: { id?: string; channel: string; author: string; daysAgo: number; replyTo?: string; body: string }[];
  reactions: { message: string; emoji: string; users: string[] }[];
}

const corpus: Corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/corpus.json', import.meta.url)), 'utf8'),
);

await db.execute('truncate table reactions, channel_reads, messages, channel_members, channels, users cascade');

const userIds = new Map<string, string>();
for (const u of corpus.users) {
  const [row] = await db.insert(users).values(u).returning({ id: users.id });
  userIds.set(u.handle, row!.id);
}

const channelIds = new Map<string, string>();
for (const c of corpus.channels) {
  const [row] = await db
    .insert(channels)
    .values({
      name: c.name,
      type: c.type,
      topic: c.topic,
      archivedAt: c.archived ? new Date(Date.now() - 150 * 86_400_000) : null,
    })
    .returning({ id: channels.id });
  channelIds.set(c.name, row!.id);
  for (const handle of c.members ?? []) {
    await db.insert(channelMembers).values({ channelId: row!.id, userId: userIds.get(handle)! });
  }
}

// Chronology: daysAgo anchors the day, array order spaces messages 5 minutes
// apart within the run so replies always land after their roots.
const now = Date.now();
const messageIds = new Map<string, string>();
for (const [index, m] of corpus.messages.entries()) {
  const [row] = await db
    .insert(messages)
    .values({
      channelId: channelIds.get(m.channel)!,
      authorId: userIds.get(m.author)!,
      parentMessageId: m.replyTo ? messageIds.get(m.replyTo)! : null,
      body: m.body,
      createdAt: new Date(now - m.daysAgo * 86_400_000 + index * 300_000),
    })
    .returning({ id: messages.id });
  if (m.id) messageIds.set(m.id, row!.id);
}

for (const r of corpus.reactions) {
  for (const handle of r.users) {
    await db.insert(reactions).values({
      messageId: messageIds.get(r.message)!,
      userId: userIds.get(handle)!,
      emoji: r.emoji,
    });
  }
}

// Read markers: everyone is caught up, except Tomas (the demo login) who
// still has a few things unread — so unread badges show up fresh.
const tomasUnread = new Set(['incident-4021', 'design', 'group-lunch']);
for (const c of corpus.channels) {
  const channelId = channelIds.get(c.name)!;
  const readers =
    c.type === 'public' ? corpus.users.map((u) => u.handle) : (c.members ?? []);
  for (const handle of readers) {
    if (handle === 'tomas' && tomasUnread.has(c.name)) continue;
    await db.insert(channelReads).values({
      channelId,
      userId: userIds.get(handle)!,
      lastReadAt: new Date(now),
    });
  }
}

console.log(
  `seeded ${corpus.users.length} users, ${corpus.channels.length} channels, ${corpus.messages.length} messages`,
);
await sql.end();
