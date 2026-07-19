import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import { buildApp } from '../src/api/routes.js';
import { space } from '../src/space/space.js';
import { CREDITS_PER_OTHER_OP, FrithState, WRITER_BURST, type Op } from '../src/space/state.js';
import { directoryEntryMessage, getDirectory } from '../src/domain/directory.js';

// The local server is reachable by any web page the user visits, so the origin
// guard and per-viewer call filtering are the difference between "loopback" and
// "any site can drive your workspace". These lock those in.

let app: FastifyInstance;
let alice: string; // member of the private channel
let bob: string; // outsider — public only
let privateChannel: string;

beforeAll(async () => {
  app = await buildApp();
  const user = async (handle: string, name: string) =>
    (await app.inject({ method: 'POST', url: '/api/dev/user', payload: { handle, name } })).json().id as string;
  alice = await user('alice', 'Alice');
  bob = await user('bob', 'Bob');
  privateChannel = (
    await app.inject({
      method: 'POST',
      url: '/api/dev/channel',
      payload: { name: 'war-room', type: 'private', memberHandles: ['alice'] },
    })
  ).json().channelId as string;
});

afterAll(async () => {
  await app.close();
  await space.close();
});

describe('cross-origin / DNS-rebinding guard', () => {
  it('blocks a request carrying a foreign Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { origin: 'https://evil.example' },
      cookies: { uid: alice },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks a request whose Host is not localhost (DNS rebinding)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { host: 'attacker.example' },
      cookies: { uid: alice },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the same-origin dev client (localhost Origin)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { origin: 'http://localhost:5173' },
      cookies: { uid: alice },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows native clients with no Origin header at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', cookies: { uid: alice } });
    expect(res.statusCode).toBe(200);
  });
});

describe('auth cookie hardening', () => {
  it('sets the dev cookie httpOnly + sameSite=strict', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { handle: 'alice' } });
    const cookie = res.cookies.find((c) => c.name === 'uid');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('strict');
  });
});

describe('per-writer append budget (HARDENING §1)', () => {
  // Every peer replays every op, so these run against the reducer directly:
  // what FrithState refuses to materialize, no peer's state grows by.
  const spammer = 'a1'.repeat(32);
  const honest = 'b2'.repeat(32);
  const msgOp = (id: string): Op => ({
    t: 'msg',
    message: {
      id,
      channelId: `c${id.length % 8}`,
      authorId: 'u-spam',
      parentMessageId: null,
      body: 'x',
      createdAt: '2026-07-19T00:00:00Z',
    },
  });

  it('caps a lone runaway writer at the burst and flags it', () => {
    const state = new FrithState();
    for (let i = 0; i < 10_000; i++) state.apply(msgOp(`m${i}`), spammer);
    expect(state.messages.size).toBe(WRITER_BURST);
    expect(state.flaggedWriters.has(spammer)).toBe(true);
  });

  it('replenishes only from other writers’ interleaved ops', () => {
    const state = new FrithState();
    for (let i = 0; i < WRITER_BURST + 10; i++) state.apply(msgOp(`m${i}`), spammer);
    expect(state.messages.size).toBe(WRITER_BURST);

    // One op from someone else earns the spammer CREDITS_PER_OTHER_OP ops of
    // headroom — no more. The honest writer's own op is unaffected by the flag.
    state.apply(msgOp('honest-1'), honest);
    expect(state.messages.has('honest-1')).toBe(true);
    for (let i = 0; i < CREDITS_PER_OTHER_OP + 10; i++) state.apply(msgOp(`r${i}`), spammer);
    expect(state.messages.size).toBe(WRITER_BURST + 1 + CREDITS_PER_OTHER_OP);
  });

  it('leaves legacy pre-envelope ops (no writer) unbudgeted', () => {
    const state = new FrithState();
    for (let i = 0; i < WRITER_BURST + 100; i++) state.apply(msgOp(`m${i}`));
    expect(state.messages.size).toBe(WRITER_BURST + 100);
  });

  it('reaches the same verdicts on a from-scratch replay', () => {
    const sequence: [Op, string][] = [];
    for (let i = 0; i < WRITER_BURST + 200; i++) {
      sequence.push([msgOp(`m${i}`), spammer]);
      if (i % 100 === 0) sequence.push([msgOp(`h${i}`), honest]);
    }
    const first = new FrithState();
    const second = new FrithState();
    for (const [op, writer] of sequence) first.apply(op, writer);
    for (const [op, writer] of sequence) second.apply(op, writer);
    expect([...second.messages.keys()]).toEqual([...first.messages.keys()]);
    expect([...second.flaggedWriters]).toEqual([...first.flaggedWriters]);
  });
});

describe('authorship policy in dev (HARDENING §5)', () => {
  it('never flags unverified — one dev writer speaks for many seeded users by design', async () => {
    const { toMessageDto } = await import('../src/domain/store.js');
    const row = {
      id: 'm-authorship',
      channelId: 'c-authorship',
      authorId: alice,
      parentMessageId: null,
      body: '',
      createdAt: new Date().toISOString(),
      verified: false,
    };
    expect(toMessageDto(row, alice).unverified).toBeUndefined();
  });
});

describe('call rosters follow channel ACL', () => {
  it('hides a private channel’s call from a non-member', async () => {
    // Alice (a member) opens a campfire in the private channel.
    const join = await app.inject({
      method: 'POST',
      url: `/api/channels/${privateChannel}/call/join`,
      cookies: { uid: alice },
    });
    expect(join.statusCode).toBe(200);

    // Bob is not a member — the roster must not appear for him.
    const bobView = await app.inject({ method: 'GET', url: '/api/calls', cookies: { uid: bob } });
    expect(bobView.statusCode).toBe(200);
    expect(bobView.json().calls[privateChannel]).toBeUndefined();

    // Alice, a member, still sees it.
    const aliceView = await app.inject({ method: 'GET', url: '/api/calls', cookies: { uid: alice } });
    expect(aliceView.json().calls[privateChannel]).toContain(alice);
  });
});

describe('directory curator signatures (HARDENING §7)', () => {
  // A compromised directory host must not be able to inject invite keys:
  // with a curator key configured, only entries that key signed are served.
  const curator = hypercoreCrypto.keyPair(crypto.randomBytes(32));
  const entry = (name: string, invite: string | null) => ({
    name,
    description: 'a place',
    tags: ['music'],
    invite,
  });
  const sign = (e: ReturnType<typeof entry>) =>
    b4a.toString(hypercoreCrypto.sign(b4a.from(directoryEntryMessage(e)), curator.secretKey), 'hex');

  const writeFeed = (entries: unknown[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frith-dir-test-'));
    fs.writeFileSync(path.join(dir, 'directory.json'), JSON.stringify({ entries }));
    return dir;
  };

  it('serves only curator-signed entries; tampered and unsigned are rejected', async () => {
    const good = entry('honest space', 'frith-invite-good');
    const signedGood = { ...good, sig: sign(good) };
    const tampered = { ...signedGood, invite: 'frith-invite-EVIL' }; // valid sig, swapped invite
    const unsigned = entry('injected space', 'frith-invite-injected');
    const dir = writeFeed([signedGood, tampered, unsigned]);
    const prevSeed = process.env.FRITH_SEED_DIR;
    process.env.FRITH_SEED_DIR = dir;
    process.env.FRITH_DIRECTORY_CURATOR_KEY = b4a.toString(curator.publicKey, 'hex');
    try {
      const feed = await getDirectory();
      expect(feed.entries.map((e) => e.name)).toEqual(['honest space']);
      expect(feed.entries[0]).not.toHaveProperty('sig'); // wire detail, not display data

      // No curator configured: external data is display-only and stays served.
      delete process.env.FRITH_DIRECTORY_CURATOR_KEY;
      expect((await getDirectory()).entries).toHaveLength(3);
    } finally {
      delete process.env.FRITH_DIRECTORY_CURATOR_KEY;
      if (prevSeed === undefined) delete process.env.FRITH_SEED_DIR;
      else process.env.FRITH_SEED_DIR = prevSeed;
    }
  });
});
