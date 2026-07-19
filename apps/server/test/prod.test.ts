import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Production posture: no dev surface, the device's bound user IS the auth.
const scratch = path.join(os.tmpdir(), `frith-prod-${process.pid}`);
process.env.FRITH_DATA = path.join(scratch, 'space');
process.env.FRITH_MODE = 'production';
// Read at module load in routes.ts, so it must be set before the import.
process.env.FRITH_TRUSTED_ORIGIN = 'app.frith.example';

const { buildApp } = await import('../src/api/routes.js');
const { space } = await import('../src/space/space.js');

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

  it('never registered the dev surface — 404 even once authed', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { handle: 'nova' } });
    expect(login.statusCode).toBe(404);
    const debug = await app.inject({ method: 'GET', url: '/api/dev/debug' });
    expect(debug.statusCode).toBe(404);
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
