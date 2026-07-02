import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/client.js';
import { channelMembers, channels, messages, users } from '../src/db/schema.js';

let app: FastifyInstance;

// Fixtures
let alice: string; // member of everything
let bob: string; // member of nothing beyond public
let publicChannel: string;
let privateChannel: string;
let dmChannel: string;

beforeAll(async () => {
  await db.execute('truncate table messages, channel_members, channels, users cascade');

  const [a] = await db.insert(users).values({ handle: 'alice', name: 'Alice' }).returning();
  const [b] = await db.insert(users).values({ handle: 'bob', name: 'Bob' }).returning();
  alice = a!.id;
  bob = b!.id;

  const [pub] = await db
    .insert(channels)
    .values({ name: 'town-square', type: 'public', topic: null })
    .returning();
  const [priv] = await db
    .insert(channels)
    .values({ name: 'secret-plans', type: 'private', topic: null })
    .returning();
  const [dm] = await db.insert(channels).values({ name: 'dm-a', type: 'dm', topic: null }).returning();
  publicChannel = pub!.id;
  privateChannel = priv!.id;
  dmChannel = dm!.id;

  await db.insert(channelMembers).values([
    { channelId: privateChannel, userId: alice },
    { channelId: dmChannel, userId: alice },
  ]);

  await db.insert(messages).values([
    { channelId: publicChannel, authorId: alice, body: 'hello world' },
    { channelId: privateChannel, authorId: alice, body: 'the launch is friday' },
  ]);

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

function as(userId: string) {
  return { cookies: { uid: userId } };
}

describe('auth', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/channels' });
    expect(res.statusCode).toBe(401);
  });

  it('logs in by handle and returns the user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dev/login',
      payload: { handle: 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Alice');
    expect(res.cookies.find((c) => c.name === 'uid')?.value).toBe(alice);
  });
});

describe('ACL — a user must never read content from channels they cannot access', () => {
  it('lets anyone read a public channel', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(bob) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('blocks a non-member from reading a private channel', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/channels/${privateChannel}/messages`, ...as(bob) });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('launch');
  });

  it('lets a member read a private channel', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/channels/${privateChannel}/messages`, ...as(alice) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('blocks a non-member from posting to a private channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${privateChannel}/messages`,
      payload: { body: 'sneaky' },
      ...as(bob),
    });
    expect(res.statusCode).toBe(403);
  });

  it('hides private and DM channels from the channel list of non-members', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/channels', ...as(bob) });
    const names = res.json().map((c: { name: string }) => c.name);
    expect(names).toContain('town-square');
    expect(names).not.toContain('secret-plans');
    expect(names).not.toContain('dm-a');
  });

  it('blocks thread access through the thread endpoint too', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/channels/${privateChannel}/messages`, ...as(alice) });
    const rootId = list.json()[0].id;
    const res = await app.inject({ method: 'GET', url: `/api/messages/${rootId}/thread`, ...as(bob) });
    expect(res.statusCode).toBe(403);
  });
});

describe('messages and threads', () => {
  it('posts a message and returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'a new message' },
      ...as(bob),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().authorName).toBe('Bob');
  });

  it('threads replies under a root and counts them', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(alice) });
    const rootId = list.json()[0].id;

    await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'a reply', parentMessageId: rootId },
      ...as(alice),
    });

    const thread = await app.inject({ method: 'GET', url: `/api/messages/${rootId}/thread`, ...as(alice) });
    const msgs = thread.json();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].replyCount).toBe(1);
    expect(msgs[1].parentMessageId).toBe(rootId);

    const relisted = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(alice) });
    expect(relisted.json().find((m: { id: string }) => m.id === rootId).replyCount).toBe(1);
    // replies never appear as top-level messages
    expect(relisted.json().some((m: { parentMessageId: string | null }) => m.parentMessageId !== null)).toBe(false);
  });
});

describe('unreads', () => {
  it("counts other people's messages until the channel is marked read", async () => {
    // Bob has no read marker; Alice authored 2 messages in town-square by now.
    const res = await app.inject({ method: 'GET', url: '/api/channels', ...as(bob) });
    const town = res.json().find((c: { name: string }) => c.name === 'town-square');
    expect(town.unreadCount).toBe(2);

    await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/read`, ...as(bob) });
    const after = await app.inject({ method: 'GET', url: '/api/channels', ...as(bob) });
    expect(after.json().find((c: { name: string }) => c.name === 'town-square').unreadCount).toBe(0);
  });

  it('never counts your own messages as unread', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'bob talking to himself' },
      ...as(bob),
    });
    const res = await app.inject({ method: 'GET', url: '/api/channels', ...as(bob) });
    expect(res.json().find((c: { name: string }) => c.name === 'town-square').unreadCount).toBe(0);
  });
});

describe('dms', () => {
  it('creates a DM once and reuses it after', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/dms/${bob}`, ...as(alice) });
    const second = await app.inject({ method: 'POST', url: `/api/dms/${alice}`, ...as(bob) });
    expect(first.json().channelId).toBe(second.json().channelId);

    const channels = await app.inject({ method: 'GET', url: '/api/channels', ...as(alice) });
    const dm = channels.json().find((c: { id: string }) => c.id === first.json().channelId);
    expect(dm.type).toBe('dm');
    expect(dm.dmPartnerNames).toEqual(['Bob']);
  });
});

describe('reactions', () => {
  it('toggles a reaction on and off', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(alice) });
    const messageId = list.json()[0].id;

    const on = await app.inject({
      method: 'POST',
      url: `/api/messages/${messageId}/reactions`,
      payload: { emoji: '👍' },
      ...as(bob),
    });
    expect(on.json().added).toBe(true);

    const seen = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(bob) });
    expect(seen.json()[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: true }]);
    const seenByAlice = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(alice) });
    expect(seenByAlice.json()[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);

    const off = await app.inject({
      method: 'POST',
      url: `/api/messages/${messageId}/reactions`,
      payload: { emoji: '👍' },
      ...as(bob),
    });
    expect(off.json().added).toBe(false);
  });
});

describe('ask retrieval — the ACL applies to search too', () => {
  it('finds public messages and ranks their authors with evidence', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ask?q=hello', ...as(bob) });
    const body = res.json();
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages[0].snippet).toContain('[[hello]]');
    expect(body.people[0].user.name).toBe('Alice');
    expect(body.people[0].evidence.length).toBeGreaterThan(0);
  });

  it('lets members find private content', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ask?q=launch', ...as(alice) });
    expect(res.json().messages.length).toBeGreaterThan(0);
  });

  it('never leaks private content into search results for non-members', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ask?q=launch', ...as(bob) });
    const body = res.json();
    expect(body.messages).toEqual([]);
    expect(body.threads).toEqual([]);
    expect(body.people).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('friday');
  });
});
