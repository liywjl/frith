import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';

// Production posture: no dev surface, the device's bound user IS the auth.
const scratch = path.join(os.tmpdir(), `frith-prod-${process.pid}`);
process.env.FRITH_DATA = path.join(scratch, 'space');
process.env.FRITH_MODE = 'production';
// Read at module load in routes.ts, so it must be set before the import.
process.env.FRITH_TRUSTED_ORIGIN = 'app.frith.example';

const { buildApp } = await import('../src/api/routes.js');
const { space } = await import('../src/space/space.js');
const { deviceBindingMessage } = await import('../src/space/state.js');

let app: FastifyInstance;

beforeAll(async () => {
  fs.rmSync(scratch, { recursive: true, force: true });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await space.close();
  delete process.env.FRITH_MODE;
  delete process.env.FRITH_TRUSTED_ORIGIN;
});

describe('production auth', () => {
  it('401s everything — dev surface included — before this device is bound', async () => {
    for (const probe of ['/api/channels', '/api/dev/debug'] as const) {
      const res = await app.inject({ method: 'GET', url: probe });
      expect(res.statusCode).toBe(401);
    }
  });

  it('acts as the bound user after profile creation — no cookie involved', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Nova', handle: 'nova' },
    });
    expect(created.statusCode).toBe(200);
    const nova = created.json().id as string;
    expect(space.boundUserId()).toBe(nova);

    const me = await app.inject({ method: 'GET', url: '/api/me' }); // deliberately cookieless
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(nova);

    // A cookie claiming someone else changes nothing in production.
    const spoofed = await app.inject({ method: 'GET', url: '/api/me', cookies: { uid: 'someone-else' } });
    expect(spoofed.json().id).toBe(nova);
  });

  it('will not re-point a bound device at another identity', async () => {
    // In production `boundUserId` IS the credential, so a second profile is an
    // identity swap. The route is unauthenticated by necessity (you have to be
    // able to create the FIRST profile), which is exactly why it has to refuse
    // once one exists — otherwise any local process silently becomes you.
    const second = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Imposter', handle: 'imposter' },
    });
    expect(second.statusCode).toBe(409);
    expect(space.state.users.size).toBe(1);

    // Importing an identity proves possession of its root seed — but a row
    // with no root on the log has nothing to prove against.
    const rootless = space.newId();
    await space.append({ t: 'user', id: rootless, patch: { handle: 'ghost', name: 'Ghost' } });
    const claim = await app.inject({
      method: 'POST',
      url: '/api/identity/import',
      payload: { code: `frith-id:${rootless}:${'ab'.repeat(32)}` },
    });
    expect(claim.statusCode).toBe(409);
    expect(space.boundUserId()).not.toBe(rootless);
  });

  it('frames nothing and is framed by nobody', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('never registered the dev surface — 404 even once authed', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { handle: 'nova' } });
    expect(login.statusCode).toBe(404);
    const debug = await app.inject({ method: 'GET', url: '/api/dev/debug' });
    expect(debug.statusCode).toBe(404);
  });
});

describe('scheduled sends are author-scoped', () => {
  it('leaves another member’s due message for their own device', async () => {
    // Every peer runs the delivery timer. Claiming everyone's due rows means
    // this device posting in other people's names, and two online peers
    // delivering the same message twice.
    const { scheduleMessage } = await import('../src/domain/store.js');
    const { deliverDueScheduled } = await import('../src/domain/scheduler.js');
    const channel = await app.inject({ method: 'POST', url: '/api/channels', payload: { name: 'plans', type: 'public' } });
    const channelId = channel.json().channelId as string;

    await scheduleMessage({
      authorId: space.state.ownerUserId!,
      channelId,
      body: 'mine to send',
      sendAt: new Date(Date.now() - 1000),
    });

    // A second member, queued while they were still deviceless, who then
    // brings their own device online — that row is now theirs to drain.
    const other = space.newId();
    await space.append({ t: 'user', id: other, patch: { handle: 'remote', name: 'Remote' } });
    await space.append({
      t: 'sched',
      scheduled: {
        id: space.newId(),
        channelId,
        authorId: other,
        parentMessageId: null,
        body: 'not ours to send',
        sendAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    const pair = hypercoreCrypto.keyPair(crypto.randomBytes(32));
    const deviceKey = crypto.randomBytes(32).toString('hex');
    await space.append({ t: 'identity', userId: other, rootKey: b4a.toString(pair.publicKey, 'hex') });
    await space.append({
      t: 'device',
      userId: other,
      deviceKey,
      sig: b4a.toString(hypercoreCrypto.sign(b4a.from(deviceBindingMessage(other, deviceKey)), pair.secretKey), 'hex'),
    });
    expect(space.state.hasBoundDevice(other)).toBe(true);

    // Only the bound user's own row is delivered.
    expect(await deliverDueScheduled()).toBe(1);
    expect(space.state.scheduled.size).toBe(1); // theirs still queued, untouched
  });
});

describe('authorship policy in production (HARDENING §5)', () => {
  it('marks a provable author/device mismatch unverified — and nothing else', async () => {
    const { toMessageDto } = await import('../src/domain/store.js');
    const channel = await app.inject({ method: 'POST', url: '/api/channels', payload: { name: 'general', type: 'public' } });
    const sent = await app.inject({
      method: 'POST',
      url: `/api/channels/${channel.json().channelId}/messages`,
      payload: { body: 'hello from my own bound device' },
    });
    expect(sent.statusCode).toBe(200);
    const row = space.state.messages.get(sent.json().id as string)!;

    // Appended by the author's own bound device: verified, no badge.
    expect(row.verified).toBe(true);
    expect(toMessageDto(row, row.authorId).unverified).toBeUndefined();
    // The same message with a proven mismatch gets the badge.
    expect(toMessageDto({ ...row, verified: false }, row.authorId).unverified).toBe(true);
    // Unknown authorship (legacy pre-envelope ops) is not an accusation.
    expect(toMessageDto({ ...row, verified: undefined }, row.authorId).unverified).toBeUndefined();
  });
});

describe('FRITH_TRUSTED_ORIGIN admits exactly one origin (HARDENING §8)', () => {
  const get = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/api/users', headers });

  it('admits the configured origin, and localhost as ever', async () => {
    expect((await get({ origin: 'https://app.frith.example' })).statusCode).toBe(200);
    expect((await get({ origin: 'http://localhost:5173' })).statusCode).toBe(200);
  });

  it('rejects every other origin — including lookalikes and port variants', async () => {
    for (const origin of [
      'https://evil.example',
      'https://evil-app.frith.example', // sibling subdomain
      'https://app.frith.example.evil.example', // suffix spoof
      'https://app.frith.example:8443', // port variant is a different origin
    ]) {
      expect((await get({ origin })).statusCode, origin).toBe(403);
    }
  });

  it('extends the Host allowance to the trusted origin and nothing else', async () => {
    expect((await get({ host: 'app.frith.example' })).statusCode).toBe(200);
    expect((await get({ host: 'evil.example' })).statusCode).toBe(403);
  });
});
