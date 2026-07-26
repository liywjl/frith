// The privilege lattice over HTTP, edge cases first: who may evict, who may
// grant admin, what an evicted credential is worth (nothing), and how the API
// answers garbage input. Runs against a live (test-mode) Space on disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const scratch = path.join(os.tmpdir(), `frith-permissions-${process.pid}`);
process.env.FRITH_DATA = path.join(scratch, 'space');

const { buildApp } = await import('../src/api/routes.js');
const { space } = await import('../src/space/space.js');

let app: FastifyInstance;
let owner: string;
let admin: string;
let member: string;
let victim: string;

const NOBODY = '00000000-0000-4000-8000-000000000000';
const as = (userId: string) => ({ cookies: { uid: userId } });

beforeAll(async () => {
  fs.rmSync(scratch, { recursive: true, force: true });
  app = await buildApp();
  const profile = async (name: string, handle: string) =>
    (await app.inject({ method: 'POST', url: '/api/profiles', payload: { name, handle } })).json().id as string;
  // First profile founds the space and owns it; the rest join as members.
  owner = await profile('Olive Owner', 'olive');
  admin = await profile('Ada Admin', 'ada');
  member = await profile('Milo Member', 'milo');
  victim = await profile('Vic Victim', 'vic');
});

afterAll(async () => {
  await app.close();
  await space.close();
});

describe('who may evict', () => {
  it('a plain member may not evict anyone', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: victim }, ...as(member) });
    expect(res.statusCode).toBe(403);
    expect(space.state.evicted.has(victim)).toBe(false);
  });

  it('a plain member may not grant admin, rename the space, or change history', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: member, admin: true }, ...as(member) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/space', payload: { name: 'Hijacked' }, ...as(member) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/history', payload: { value: 'join-forward' }, ...as(member) }))
        .statusCode,
    ).toBe(403);
  });

  it('the owner grants admin — and only to someone who exists', async () => {
    const ghost = await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: NOBODY, admin: true }, ...as(owner) });
    expect(ghost.statusCode).toBe(403);

    const res = await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: admin, admin: true }, ...as(owner) });
    expect(res.statusCode).toBe(200);
    expect(space.state.admins.has(admin)).toBe(true);
  });

  it('an admin manages settings but never the role lattice', async () => {
    // Manager surface: yes.
    const rename = await app.inject({ method: 'PATCH', url: '/api/space', payload: { name: 'Frith HQ' }, ...as(admin) });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().name).toBe('Frith HQ');
    // Owner surface: no — admins don't mint admins or rewrite history rules.
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: member, admin: true }, ...as(admin) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/history', payload: { value: 'join-forward' }, ...as(admin) }))
        .statusCode,
    ).toBe(403);
  });

  it('an admin may not evict the owner', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: owner }, ...as(admin) });
    expect(res.statusCode).toBe(403);
    expect(space.state.evicted.has(owner)).toBe(false);
  });

  it('nobody can evict a user who does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: NOBODY }, ...as(owner) });
    expect(res.statusCode).toBe(403);
  });

  it('an admin evicts a member — and the evicted cookie is dead on arrival', async () => {
    // The victim is alive first.
    expect((await app.inject({ method: 'GET', url: '/api/channels', ...as(victim) })).statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: victim }, ...as(admin) });
    expect(res.statusCode).toBe(200);
    expect(space.state.evicted.has(victim)).toBe(true);

    // A stale session is not a way back in — reads and writes both 401.
    expect((await app.inject({ method: 'GET', url: '/api/channels', ...as(victim) })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: member }, ...as(victim) })).statusCode,
    ).toBe(401);
  });

  it('a revoked admin loses the manager surface immediately', async () => {
    await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: admin, admin: false }, ...as(owner) });
    expect(space.state.admins.has(admin)).toBe(false);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: member }, ...as(admin) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/space', payload: { name: 'Nope' }, ...as(admin) })).statusCode,
    ).toBe(403);
  });
});

describe('who may archive a public channel', () => {
  // A public channel is space-wide, so archiving it (which freezes all posting)
  // is a manager action — not something any reader can do to grief the space.
  let channel: string;

  it('a plain member may not archive a public channel', async () => {
    channel = (
      await app.inject({
        method: 'POST',
        url: '/api/channels',
        payload: { name: 'town-square', type: 'public' },
        ...as(owner),
      })
    ).json().channelId as string;

    const res = await app.inject({ method: 'POST', url: `/api/channels/${channel}/archive`, ...as(member) });
    expect(res.statusCode).toBe(403);

    // The channel still accepts posts — nothing was frozen.
    const post = await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: 'still open' },
      ...as(member),
    });
    expect(post.statusCode).toBe(200);
  });

  it('the owner archives and unarchives a public channel', async () => {
    const archived = await app.inject({ method: 'POST', url: `/api/channels/${channel}/archive`, ...as(owner) });
    expect(archived.statusCode).toBe(200);

    // Posting is frozen while archived.
    const frozen = await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: 'nope' },
      ...as(member),
    });
    expect(frozen.statusCode).toBe(409);

    const unarchived = await app.inject({ method: 'POST', url: `/api/channels/${channel}/unarchive`, ...as(owner) });
    expect(unarchived.statusCode).toBe(200);
  });
});

describe('malformed input is the caller’s fault', () => {
  it('answers 400 (never 500) to garbage bodies', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: 'not-a-uuid' }, ...as(owner) }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/space', payload: { name: '' } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: owner }, ...as(owner) })).statusCode,
    ).toBe(400);
  });

  it('rejects a malformed invite with a helpful 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/space/join', payload: { invite: 'not-an-invite' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('invite');
  });
});
