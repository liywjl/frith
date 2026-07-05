// Loads the fictional Acme corpus into the current space's log — the same
// coherent storylines as always, now as ops instead of SQL inserts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { space } from '../space/space.js';
import type { UserRow } from '../space/state.js';

interface Corpus {
  users: (Pick<UserRow, 'handle' | 'name'> & Partial<UserRow>)[];
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

const CORPORA = {
  acme: 'corpus.json', // the original: work
  skate: 'corpus-skate.json', // friends: rollerblading crew
  band: 'corpus-band.json', // friends: a band
} as const;

export async function seedCorpus(name: keyof typeof CORPORA = 'acme') {
  const dir = process.env.LORE_SEED_DIR ?? fileURLToPath(new URL('../../seed', import.meta.url));
  const corpus: Corpus = JSON.parse(readFileSync(`${dir}/${CORPORA[name]}`, 'utf8'));
  const now = Date.now();

  const userIds = new Map<string, string>();
  for (const u of corpus.users) {
    const existing = [...space.state.users.values()].find((row) => row.handle === u.handle);
    const id = existing?.id ?? space.newId();
    userIds.set(u.handle, id);
    await space.append({ t: 'user', id, patch: { ...u } });
  }

  const channelIds = new Map<string, string>();
  for (const c of corpus.channels) {
    const existing = [...space.state.channels.values()].find((row) => row.name === c.name);
    const id = existing?.id ?? space.newId();
    channelIds.set(c.name, id);
    if (!existing) {
      await space.append({
        t: 'channel',
        channel: {
          id,
          name: c.name,
          type: c.type,
          topic: c.topic,
          archivedAt: c.archived ? new Date(now - 150 * 86_400_000).toISOString() : null,
        },
      });
      for (const handle of c.members ?? []) {
        await space.append({ t: 'member', channelId: id, userId: userIds.get(handle)! });
      }
    }
  }

  // Chronology: daysAgo anchors the day, array order spaces messages 5
  // minutes apart so replies always land after their roots.
  const messageIds = new Map<string, string>();
  for (const [index, m] of corpus.messages.entries()) {
    const id = space.newId();
    if (m.id) messageIds.set(m.id, id);
    await space.append({
      t: 'msg',
      message: {
        id,
        channelId: channelIds.get(m.channel)!,
        authorId: userIds.get(m.author)!,
        parentMessageId: m.replyTo ? (messageIds.get(m.replyTo) ?? null) : null,
        body: m.body,
        createdAt: new Date(now - m.daysAgo * 86_400_000 + index * 300_000).toISOString(),
      },
    });
  }

  for (const r of corpus.reactions) {
    for (const handle of r.users) {
      await space.append({
        t: 'react',
        messageId: messageIds.get(r.message)!,
        userId: userIds.get(handle)!,
        emoji: r.emoji,
        on: true,
      });
    }
  }

  // Read markers: everyone caught up except Tomas, who has fresh unreads.
  const tomasUnread = new Set(['incident-4021', 'design', 'group-lunch']);
  for (const c of corpus.channels) {
    const readers = c.type === 'public' ? corpus.users.map((u) => u.handle) : (c.members ?? []);
    for (const handle of readers) {
      if (handle === 'tomas' && tomasUnread.has(c.name)) continue;
      await space.append({
        t: 'read',
        userId: userIds.get(handle)!,
        channelId: channelIds.get(c.name)!,
        at: new Date(now).toISOString(),
      });
    }
  }

  return { users: corpus.users.length, channels: corpus.channels.length, messages: corpus.messages.length };
}
