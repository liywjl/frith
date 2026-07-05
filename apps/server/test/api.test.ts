import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/routes.js';
import { scheduleMessage } from '../src/domain/store.js';
import { deliverDueScheduled } from '../src/domain/scheduler.js';
import { space } from '../src/space/space.js';

let app: FastifyInstance;

// Fixtures
let alice: string; // member of everything
let bob: string; // member of nothing beyond public
let carol: string; // third wheel for group conversations
let publicChannel: string;
let privateChannel: string;
let dmChannel: string;

beforeAll(async () => {
  app = await buildApp();

  const user = async (handle: string, name: string) =>
    (await app.inject({ method: 'POST', url: '/api/dev/user', payload: { handle, name } })).json().id as string;
  alice = await user('alice', 'Alice');
  bob = await user('bob', 'Bob');
  carol = await user('carol', 'Carol');

  const channel = async (name: string, type: string, memberHandles: string[] = []) =>
    (await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name, type, memberHandles } })).json()
      .channelId as string;
  publicChannel = await channel('town-square', 'public');
  privateChannel = await channel('secret-plans', 'private', ['alice']);
  dmChannel = await channel('dm-a', 'dm', ['alice']);
  void dmChannel;

  await app.inject({
    method: 'POST',
    url: `/api/channels/${publicChannel}/messages`,
    payload: { body: 'hello world' },
    cookies: { uid: alice },
  });
  await app.inject({
    method: 'POST',
    url: `/api/channels/${privateChannel}/messages`,
    payload: { body: 'the launch is friday' },
    cookies: { uid: alice },
  });
});

afterAll(async () => {
  await app.close();
  await space.close();
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

describe('profiles', () => {
  it('updates the profile and returns it from /api/me', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      payload: { name: 'Alice Cooper', title: 'Guitarist', team: 'Band', avatarEmoji: '🎸', theme: 'midnight' },
      ...as(alice),
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Alice Cooper');

    const me = await app.inject({ method: 'GET', url: '/api/me', ...as(alice) });
    expect(me.json()).toMatchObject({
      name: 'Alice Cooper',
      title: 'Guitarist',
      team: 'Band',
      avatarEmoji: '🎸',
      theme: 'midnight',
    });
  });

  it('rejects an unknown theme', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      payload: { theme: 'vaporwave' },
      ...as(alice),
    });
    expect(res.statusCode).toBe(500); // zod parse failure — fine for dev auth surface
  });

  it('clears a timed status once it expires', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/me',
      payload: { statusEmoji: '☕', statusText: 'coffee run', statusExpiresInMinutes: 30 },
      ...as(bob),
    });
    const me = await app.inject({ method: 'GET', url: '/api/me', ...as(bob) });
    expect(me.json().statusEmoji).toBe('☕');
    expect(me.json().statusExpiresAt).not.toBeNull();

    // Time-travel: force the expiry into the past via a direct op.
    await space.append({
      t: 'user',
      id: bob,
      patch: { handle: 'bob', name: 'Bob', statusExpiresAt: new Date(Date.now() - 60_000).toISOString() },
    });

    const list = await app.inject({ method: 'GET', url: '/api/users', ...as(alice) });
    const bobDto = list.json().find((u: { handle: string }) => u.handle === 'bob');
    expect(bobDto.statusEmoji).toBeNull();
    expect(bobDto.statusText).toBeNull();

    const meAfter = await app.inject({ method: 'GET', url: '/api/me', ...as(bob) });
    expect(meAfter.json().statusEmoji).toBeNull();
    expect(meAfter.json().statusExpiresAt).toBeNull();
  });

  it('shows the author avatar emoji on messages', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(bob) });
    expect(list.json()[0].authorAvatarEmoji).toBe('🎸');
  });
});

describe('group conversations', () => {
  it('creates a group with the exact member set and reuses it', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { userIds: [bob, carol] },
      ...as(alice),
    });
    expect(first.statusCode).toBe(200);
    const groupId = first.json().channelId;

    // Same set requested by another member → same channel.
    const second = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { userIds: [alice, carol] },
      ...as(bob),
    });
    expect(second.json().channelId).toBe(groupId);

    const channels = await app.inject({ method: 'GET', url: '/api/channels', ...as(carol) });
    const group = channels.json().find((c: { id: string }) => c.id === groupId);
    expect(group.type).toBe('dm');
    expect([...group.dmPartnerNames].sort()).toEqual(['Alice Cooper', 'Bob']);
  });

  it('does not reuse the 1:1 DM when a group shares those members', async () => {
    const dm = await app.inject({ method: 'POST', url: `/api/dms/${bob}`, ...as(alice) });
    const group = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { userIds: [bob, carol] },
      ...as(alice),
    });
    expect(dm.json().channelId).not.toBe(group.json().channelId);
  });
});

describe('profile pages and home digest', () => {
  it('profile stats and activity are scoped to what the viewer can read', async () => {
    const asBob = await app.inject({ method: 'GET', url: `/api/users/${alice}/profile`, ...as(bob) });
    expect(asBob.statusCode).toBe(200);
    expect(asBob.json().user.name).toBe('Alice Cooper');
    // The private-channel message must never surface for a non-member viewer.
    expect(JSON.stringify(asBob.json().recent)).not.toContain('launch is friday');

    const asAlice = await app.inject({ method: 'GET', url: `/api/users/${alice}/profile`, ...as(alice) });
    // Alice can see her own private-channel activity; Bob cannot.
    expect(asAlice.json().stats.messages).toBeGreaterThan(asBob.json().stats.messages);
    expect(asBob.json().topChannels.map((c: { name: string }) => c.name)).not.toContain('secret-plans');
  });

  it('home lists unread conversations and threads you are in, ACL-filtered', async () => {
    const home = (await app.inject({ method: 'GET', url: '/api/home', ...as(alice) })).json();
    expect(home.threads.some((t: { rootSnippet: string }) => t.rootSnippet.includes('hello world'))).toBe(true);
    for (const u of home.unread) expect(u.unreadCount).toBeGreaterThan(0);

    const bobHome = (await app.inject({ method: 'GET', url: '/api/home', ...as(bob) })).json();
    expect(JSON.stringify(bobHome)).not.toContain('secret-plans');
    expect(JSON.stringify(bobHome)).not.toContain('launch is friday');
  });
});

describe('channel lifecycle', () => {
  it('creates a channel with a normalized name and opens it to everyone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { name: '  Project Phoenix!  ', type: 'public', topic: 'rebuild' },
      ...as(alice),
    });
    expect(res.statusCode).toBe(200);
    const channelId = res.json().channelId;

    const list = await app.inject({ method: 'GET', url: '/api/channels', ...as(bob) });
    const created = list.json().find((c: { id: string }) => c.id === channelId);
    expect(created.name).toBe('project-phoenix');
    expect(created.archivedAt).toBeNull();
  });

  it('rejects duplicate and unusable names', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { name: 'Project Phoenix', type: 'public' },
      ...as(bob),
    });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { name: '!!!', type: 'public' },
      ...as(bob),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('makes the creator a member of a new private channel, and only them', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { name: 'skunkworks', type: 'private' },
      ...as(alice),
    });
    const channelId = res.json().channelId;
    const mine = await app.inject({ method: 'GET', url: `/api/channels/${channelId}/messages`, ...as(alice) });
    expect(mine.statusCode).toBe(200);
    const theirs = await app.inject({ method: 'GET', url: `/api/channels/${channelId}/messages`, ...as(bob) });
    expect(theirs.statusCode).toBe(403);
  });

  it('archived channels are read-only but stay readable and searchable', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'the zeppelin launch procedure lives here' },
      ...as(alice),
    });
    const archive = await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/archive`, ...as(alice) });
    expect(archive.statusCode).toBe(200);

    const post = await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'should bounce' },
      ...as(bob),
    });
    expect(post.statusCode).toBe(409);

    const read = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(bob) });
    expect(read.statusCode).toBe(200);

    const searched = await app.inject({ method: 'GET', url: '/api/ask?q=zeppelin', ...as(bob) });
    expect(searched.json().messages.length).toBeGreaterThan(0);

    const unarchive = await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/unarchive`,
      ...as(alice),
    });
    expect(unarchive.statusCode).toBe(200);
    const postAgain = await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'back in business' },
      ...as(bob),
    });
    expect(postAgain.statusCode).toBe(200);
  });

  it('refuses to archive a DM', async () => {
    const dm = await app.inject({ method: 'POST', url: `/api/dms/${bob}`, ...as(alice) });
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${dm.json().channelId}/archive`,
      ...as(alice),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('attachments', () => {
  // A real (tiny) PNG prefix: magic bytes are what the upload sniffer checks.
  const PNG_BYTES = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('lore-test-image-payload'),
  ]);

  function multipart(fields: Record<string, string>, filename: string, content: Buffer, mime: string) {
    const boundary = 'lore-test-boundary';
    const parts: Buffer[] = Object.entries(fields).map(([k, v]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    );
    return {
      payload: Buffer.from(Buffer.concat(parts)),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  const upload = (channelId: string, filename: string, content: Buffer, mime: string, uid: string) =>
    app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/attachments`,
      ...multipart({ caption: 'attached' }, filename, content, mime),
      cookies: { uid },
    });

  it('uploads a file as a message and serves it back with the channel ACL', async () => {
    const res = await upload(privateChannel, 'diagram.png', PNG_BYTES, 'image/png', alice);
    expect(res.statusCode).toBe(200);
    const attachment = res.json().attachments[0];
    expect(attachment.kind).toBe('image');
    expect(attachment.cached).toBe(true); // our own upload — bytes are here
    expect(attachment.size).toBe(PNG_BYTES.length);

    const asMember = await app.inject({ method: 'GET', url: attachment.url, cookies: { uid: alice } });
    expect(asMember.statusCode).toBe(200);
    expect(asMember.rawPayload.equals(PNG_BYTES)).toBe(true);
    expect(asMember.headers['content-disposition']).toContain('inline');

    // Non-members must not fetch files from private channels.
    const asOutsider = await app.inject({ method: 'GET', url: attachment.url, cookies: { uid: bob } });
    expect(asOutsider.statusCode).toBe(403);
  });

  it('demotes media whose bytes are not what they claim (no inline render)', async () => {
    const res = await upload(publicChannel, 'totally-a-photo.png', Buffer.from('#!/bin/sh\necho pwned'), 'image/png', alice);
    expect(res.statusCode).toBe(200);
    const attachment = res.json().attachments[0];
    expect(attachment.kind).toBe('file'); // sniffed, not believed

    const served = await app.inject({ method: 'GET', url: attachment.url, cookies: { uid: bob } });
    expect(served.headers['content-type']).toBe('application/octet-stream');
    expect(served.headers['content-disposition']).toContain('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  it('flags executable-looking files as dangerous', async () => {
    const res = await upload(publicChannel, 'setup.sh', Buffer.from('#!/bin/sh'), 'text/x-sh', alice);
    expect(res.json().attachments[0].dangerous).toBe(true);
  });

  it('enforces the device upload cap from storage policies', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/storage/policies',
      payload: { maxUploadMB: 1 },
      ...as(alice),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().policies.maxUploadMB).toBe(1);

    const big = Buffer.alloc(1024 * 1024 + 1, 7);
    const res = await upload(publicChannel, 'huge.bin', big, 'application/octet-stream', alice);
    expect(res.statusCode).toBe(413);

    await app.inject({ method: 'PUT', url: '/api/storage/policies', payload: { maxUploadMB: 100 }, ...as(alice) });
  });

  it('reports storage policies and cache usage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/storage', ...as(alice) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.policies.autoFetchMB).toBeGreaterThan(0);
    expect(body.usage.cachedBytes).toBe(0); // nothing fetched from peers in tests
  });
});

describe('pins (favourites)', () => {
  it('pins are per-user and ordered', async () => {
    await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/pin`, payload: { pinned: true }, ...as(alice) });
    const mine = await app.inject({ method: 'GET', url: '/api/channels', ...as(alice) });
    expect(mine.json().find((c: { id: string }) => c.id === publicChannel).pinned).toBe(0);

    const theirs = await app.inject({ method: 'GET', url: '/api/channels', ...as(bob) });
    expect(theirs.json().find((c: { id: string }) => c.id === publicChannel).pinned).toBeNull();

    await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/pin`, payload: { pinned: false }, ...as(alice) });
    const after = await app.inject({ method: 'GET', url: '/api/channels', ...as(alice) });
    expect(after.json().find((c: { id: string }) => c.id === publicChannel).pinned).toBeNull();
  });
});

describe('scheduled sends', () => {
  it('schedules, lists, and cancels', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/schedule`,
      payload: { body: 'future greetings', inMinutes: 60 },
      ...as(alice),
    });
    expect(created.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/scheduled', ...as(alice) });
    expect(list.json().some((s: { body: string }) => s.body === 'future greetings')).toBe(true);

    await app.inject({ method: 'DELETE', url: `/api/scheduled/${created.json().id}`, ...as(alice) });
    const after = await app.inject({ method: 'GET', url: '/api/scheduled', ...as(alice) });
    expect(after.json().some((s: { body: string }) => s.body === 'future greetings')).toBe(false);
  });

  it('delivers due messages as real posts', async () => {
    await scheduleMessage({
      authorId: alice,
      channelId: publicChannel,
      body: 'delivered from the past',
      sendAt: new Date(Date.now() - 1000),
    });
    const delivered = await deliverDueScheduled();
    expect(delivered).toBeGreaterThan(0);

    const messages = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(bob) });
    expect(JSON.stringify(messages.json())).toContain('delivered from the past');
    const queue = await app.inject({ method: 'GET', url: '/api/scheduled', ...as(alice) });
    expect(queue.json().some((s: { body: string }) => s.body === 'delivered from the past')).toBe(false);
  });
});

describe('campfires (calls)', () => {
  it('tracks membership and tells joiners who was already there', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/call/join`, ...as(alice) });
    expect(first.json().participants).toEqual([]);

    const second = await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/call/join`, ...as(bob) });
    expect(second.json().participants).toEqual([alice]);

    const snapshot = await app.inject({ method: 'GET', url: '/api/calls', ...as(carol) });
    expect([...snapshot.json()[publicChannel]].sort()).toEqual([alice, bob].sort());

    await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/call/leave`, ...as(bob) });
    await app.inject({ method: 'POST', url: `/api/channels/${publicChannel}/call/leave`, ...as(alice) });
    const after = await app.inject({ method: 'GET', url: '/api/calls', ...as(carol) });
    expect(after.json()[publicChannel]).toBeUndefined();
  });

  it('requires channel access to join a campfire', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/channels/${privateChannel}/call/join`, ...as(bob) });
    expect(res.statusCode).toBe(403);
  });
});

describe('spaces', () => {
  it('exposes the current space with a capability invite', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/space', ...as(bob) });
    expect(read.json().invite).toMatch(/^lore:[^:]+:[0-9a-f]{40,}$/);
    expect(read.json().connectedPeers).toBe(0);
  });

  it('rejects garbage invites', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/space/join',
      payload: { invite: 'not-an-invite' },
      ...as(alice),
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('blocking', () => {
  it('hides a blocked person everywhere and stops DMs both ways', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: { body: 'the kraken schematics are ready' },
      ...as(bob),
    });
    await app.inject({ method: 'POST', url: `/api/users/${bob}/block`, ...as(alice) });

    const me = await app.inject({ method: 'GET', url: '/api/me', ...as(alice) });
    expect(me.json().blockedUserIds).toContain(bob);

    const list = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(alice) });
    expect(JSON.stringify(list.json())).not.toContain('kraken');

    const searched = await app.inject({ method: 'GET', url: '/api/ask?q=kraken', ...as(alice) });
    expect(searched.json().messages).toEqual([]);

    const dmFromAlice = await app.inject({ method: 'POST', url: `/api/dms/${bob}`, ...as(alice) });
    expect(dmFromAlice.statusCode).toBe(403);
    const dmFromBob = await app.inject({ method: 'POST', url: `/api/dms/${alice}`, ...as(bob) });
    expect(dmFromBob.statusCode).toBe(403);

    // Everyone else still sees Bob fine.
    const carolView = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(carol) });
    expect(JSON.stringify(carolView.json())).toContain('kraken');
  });

  it('unblocking restores everything', async () => {
    await app.inject({ method: 'DELETE', url: `/api/users/${bob}/block`, ...as(alice) });
    const list = await app.inject({ method: 'GET', url: `/api/channels/${publicChannel}/messages`, ...as(alice) });
    expect(JSON.stringify(list.json())).toContain('kraken');
    const dm = await app.inject({ method: 'POST', url: `/api/dms/${bob}`, ...as(alice) });
    expect(dm.statusCode).toBe(200);
  });
});

describe('connect suggestions', () => {
  it('suggests people and groups from shared interests', async () => {
    const setInterests = (uid: string, interests: string[]) =>
      app.inject({ method: 'PATCH', url: '/api/me', payload: { interests }, ...as(uid) });
    await setInterests(alice, ['Dogs', 'chess']);
    await setInterests(bob, ['dogs', 'running']);
    await setInterests(carol, ['dogs']);

    const res = await app.inject({ method: 'GET', url: '/api/connect', ...as(alice) });
    const body = res.json();

    const names = body.people.map((p: { user: { name: string } }) => p.user.name);
    expect(names).toContain('Bob');
    expect(names).toContain('Carol');
    // case-insensitive matching: Alice's "Dogs" matches bob's "dogs"
    expect(body.people[0].sharedInterests.map((i: string) => i.toLowerCase())).toContain('dogs');

    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].interest.toLowerCase()).toBe('dogs');
    expect(body.groups[0].members).toHaveLength(2);
    expect(body.groups[0].existingChannelId).toBeNull();
  });

  it('suggests opening an existing channel named after the interest', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { name: 'dogs', type: 'public' },
      ...as(bob),
    });
    const res = await app.inject({ method: 'GET', url: '/api/connect', ...as(alice) });
    expect(res.json().groups[0].existingChannelId).not.toBeNull();
  });

  it('suggests nothing to someone who shared no interests', async () => {
    await app.inject({ method: 'PATCH', url: '/api/me', payload: { interests: [] }, ...as(carol) });
    const res = await app.inject({ method: 'GET', url: '/api/connect', ...as(carol) });
    expect(res.json()).toEqual({ people: [], groups: [] });
  });
});

describe('task scoping', () => {
  it('scopes requirements into people, discussions, and artifacts', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/channels/${publicChannel}/messages`,
      payload: {
        body: 'The zeppelin reconciliation logic lives in reconcile/report.ts — runbook at https://acme.example/runbook',
      },
      ...as(alice),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/task-scope',
      payload: { requirements: 'I need to fix the zeppelin reconciliation checks' },
      ...as(bob),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matchCount).toBeGreaterThan(0);
    expect(body.people[0].user.name).toBe('Alice Cooper');
    const refs = body.artifacts.map((a: { ref: string }) => a.ref);
    expect(refs).toContain('reconcile/report.ts');
    expect(refs).toContain('https://acme.example/runbook');
  });

  it('applies the ACL to task scoping too', async () => {
    // 'friday' appears only in the private channel bob cannot read.
    const res = await app.inject({
      method: 'POST',
      url: '/api/task-scope',
      payload: { requirements: 'friday scheduling plans' },
      ...as(bob),
    });
    const body = res.json();
    expect(body.people).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('launch is friday');
  });
});

describe('ask retrieval — the ACL applies to search too', () => {
  it('finds public messages and ranks their authors with evidence', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ask?q=hello', ...as(bob) });
    const body = res.json();
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages[0].snippet).toContain('[[hello]]');
    expect(body.people[0].user.name).toBe('Alice Cooper');
    expect(body.people[0].evidence.length).toBeGreaterThan(0);
  });

  it('lets members find private content', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ask?q=launch', ...as(alice) });
    expect(res.json().messages.length).toBeGreaterThan(0);
  });

  it('never leaks private content into search results for non-members', async () => {
    // 'friday' only appears in the private channel's message.
    const res = await app.inject({ method: 'GET', url: '/api/ask?q=friday', ...as(bob) });
    const body = res.json();
    expect(body.messages).toEqual([]);
    expect(body.threads).toEqual([]);
    expect(body.people).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('launch is friday');
  });
});

describe('add-ons (custom tabs)', () => {
  it('creates a tab, adds and toggles items, and removes it for everyone', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/addons',
      payload: { name: 'Summer jam prep', emoji: '✅', kind: 'checklist' },
      ...as(alice),
    });
    expect(created.statusCode).toBe(200);
    const addon = created.json();
    expect(addon.createdByName).toBe('Alice Cooper');

    const withItem = await app.inject({
      method: 'POST',
      url: `/api/addons/${addon.id}/items`,
      payload: { text: 'Book the park' },
      ...as(bob),
    });
    const item = withItem.json().items[0];
    expect(item.text).toBe('Book the park');
    expect(item.done).toBe(false);

    const toggled = await app.inject({
      method: 'PUT',
      url: `/api/addons/${addon.id}/items/${item.id}`,
      payload: { done: true },
      ...as(alice),
    });
    expect(toggled.json().items[0].done).toBe(true);

    const removed = await app.inject({ method: 'DELETE', url: `/api/addons/${addon.id}`, ...as(bob) });
    expect(removed.json().ok).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/api/addons', ...as(alice) });
    expect(list.json().some((a: { id: string }) => a.id === addon.id)).toBe(false);
  });
});

describe('files view', () => {
  it('lists only files the viewer may see', async () => {
    // The attachments suite uploaded diagram.png into the private channel.
    const mine = await app.inject({ method: 'GET', url: '/api/files', ...as(alice) });
    expect(mine.json().some((f: { name: string }) => f.name === 'diagram.png')).toBe(true);

    const theirs = await app.inject({ method: 'GET', url: '/api/files', ...as(bob) });
    expect(theirs.json().some((f: { name: string }) => f.name === 'diagram.png')).toBe(false);
    // …but public uploads are visible to everyone.
    expect(theirs.json().some((f: { name: string }) => f.name === 'setup.sh')).toBe(true);
  });

  it('surfaces shared files in ask, ACL-filtered', async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/ask?q=diagram', ...as(alice) });
    expect(mine.json().files.some((f: { name: string }) => f.name === 'diagram.png')).toBe(true);
    const theirs = await app.inject({ method: 'GET', url: '/api/ask?q=diagram', ...as(bob) });
    expect(theirs.json().files).toEqual([]);
  });
});

// LAST: switching spaces swaps the whole world; the fixtures above live in
// the original space.
describe('multi-space', () => {
  it('creates a second space, seeds it, and switches back — fully isolated', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/spaces' })).json();
    const homeDir = before.active as string;

    await app.inject({ method: 'POST', url: '/api/space', payload: { name: 'Blade Crew' } });
    const seeded = await app.inject({ method: 'POST', url: '/api/dev/seed', payload: { corpus: 'skate' } });
    expect(seeded.json().users).toBe(6);

    const crew = (await app.inject({ method: 'GET', url: '/api/users' })).json();
    expect(crew.some((u: { handle: string }) => u.handle === 'mika')).toBe(true);
    expect(crew.some((u: { handle: string }) => u.handle === 'alice')).toBe(false); // other world

    const list = (await app.inject({ method: 'GET', url: '/api/spaces' })).json();
    expect(list.spaces.length).toBe(2);
    expect(list.active).not.toBe(homeDir);

    // The old cookie means nothing here — auth is per-space.
    const denied = await app.inject({ method: 'GET', url: '/api/channels', ...as(alice) });
    expect(denied.statusCode).toBe(401);

    const switched = await app.inject({ method: 'POST', url: '/api/spaces/switch', payload: { dir: homeDir } });
    expect(switched.statusCode).toBe(200);
    const back = (await app.inject({ method: 'GET', url: '/api/users' })).json();
    expect(back.some((u: { handle: string }) => u.handle === 'alice')).toBe(true);

    const bogus = await app.inject({ method: 'POST', url: '/api/spaces/switch', payload: { dir: 'nope' } });
    expect(bogus.statusCode).toBe(404);
  });
});
