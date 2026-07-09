// Loads the fictional Acme corpus into the current space's log — the same
// coherent storylines as always, now as ops instead of SQL inserts.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { space } from '../space/space.js';
import type { UserRow } from '../space/state.js';

export interface Corpus {
  /** owner/admin give the demo space a real management chain (see below). */
  users: (Pick<UserRow, 'handle' | 'name'> & Partial<UserRow> & { owner?: boolean; admin?: boolean })[];
  channels: {
    name: string;
    type: 'public' | 'private' | 'dm';
    topic: string;
    members?: string[];
    archived?: boolean;
  }[];
  messages: { id?: string; channel: string; author: string; daysAgo: number; replyTo?: string; body: string }[];
  reactions: { message: string; emoji: string; users: string[] }[];
  /** Shared docs (markdown; one array entry per line). */
  docs?: { title: string; author: string; daysAgo: number; body: string[] }[];
}

const CORPORA = {
  acme: 'corpus.json', // the original: work
  skate: 'corpus-skate.json', // friends: rollerblading crew
  band: 'corpus-band.json', // friends: a band
} as const;

export async function seedCorpus(name: keyof typeof CORPORA = 'acme') {
  // .href so this also typechecks in the mobile program, where the global URL
  // type is react-native's rather than node:url's.
  const dir = process.env.FRITH_SEED_DIR ?? fileURLToPath(new URL('../../seed', import.meta.url).href);
  return seedCorpusData(JSON.parse(readFileSync(`${dir}/${CORPORA[name]}`, 'utf8')) as Corpus);
}

/** Seed from an already-loaded corpus — the mobile worklet has no seed dir on
 *  disk, so it bundles the JSON and hands it in directly. */
export async function seedCorpusData(corpus: Corpus) {
  const now = Date.now();

  const userIds = new Map<string, string>();
  for (const u of corpus.users) {
    const existing = [...space.state.users.values()].find((row) => row.handle === u.handle);
    const id = existing?.id ?? space.newId();
    userIds.set(u.handle, id);
    const { owner: _owner, admin: _admin, ...patch } = u;
    await space.append({ t: 'user', id, patch });
  }

  // Management chain: the corpus's designated owner mints the space's first
  // identity (first identity = owner), then grants admin to the flagged users.
  // Skipped when the space already has an owner — seeding into a real space
  // must never steal it (and we won't sign role ops as the human owner).
  if (!space.state.ownerUserId) {
    const ownerHandle = corpus.users.find((u) => u.owner)?.handle;
    if (ownerHandle) {
      const ownerId = userIds.get(ownerHandle)!;
      await space.bindLocalDevice(ownerId, randomBytes(32).toString('hex'));
      for (const u of corpus.users) {
        if (u.admin && u.handle !== ownerHandle) {
          await space.setAdmin(userIds.get(u.handle)!, true, ownerId);
        }
      }
    }
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

  // Shared docs: the space's living pages — checklists, runbooks, reference.
  // Sealed under the space key exactly like store.createDoc.
  for (const d of corpus.docs ?? []) {
    if ([...space.state.docs.values()].some((row) => space.decryptBody(row.title) === d.title)) continue;
    const authorId = userIds.get(d.author)!;
    await space.ensureDomainKey('space', authorId);
    await space.append({
      t: 'doc',
      doc: {
        id: space.newId(),
        title: space.encryptBody('space', d.title),
        body: space.encryptBody('space', d.body.join('\n')),
        createdBy: authorId,
        updatedBy: authorId,
        updatedAt: new Date(now - d.daysAgo * 86_400_000).toISOString(),
      },
    });
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

  return {
    users: corpus.users.length,
    channels: corpus.channels.length,
    messages: corpus.messages.length,
    docs: corpus.docs?.length ?? 0,
  };
}
