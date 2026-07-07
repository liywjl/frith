// The manager surface end to end: PATCH /api/space and the logo endpoints, run
// against a live (test-mode) Space with its encrypted registry on disk. Proves
// the route → Space → reducer → DTO round-trip and that logo bytes serve back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const scratch = path.join(os.tmpdir(), `frith-space-settings-${process.pid}`);
process.env.FRITH_DATA = path.join(scratch, 'space');

const { buildApp } = await import('../src/api/routes.js');
const { space } = await import('../src/space/space.js');

let app: FastifyInstance;
let owner: string;

beforeAll(async () => {
  fs.rmSync(scratch, { recursive: true, force: true });
  app = await buildApp();
  owner = (await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'Owner', handle: 'owner' } })).json()
    .id as string;
});

afterAll(async () => {
  await app.close();
  await space.close();
});

// A real (tiny) PNG: magic bytes are what the upload sniffer checks.
const PNG_BYTES = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('frith-logo-payload')]);

function multipartImage(content: Buffer, mime: string) {
  const boundary = 'frith-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const as = (userId: string) => ({ cookies: { uid: userId } });

describe('space settings over HTTP', () => {
  it('owns the space (bind on profile create) and starts with no description/logo', async () => {
    expect(space.state.ownerUserId).toBe(owner);
    const dto = (await app.inject({ method: 'GET', url: '/api/space' })).json();
    expect(dto.description).toBeNull();
    expect(dto.logoUrl).toBeNull();
    expect(dto.canManage).toBe(true);
  });

  it('requires auth for the manager surface (PATCH, logo, evict, admins)', async () => {
    // No cookie → 401. The pre-login exemption covers only read/join/create.
    expect((await app.inject({ method: 'PATCH', url: '/api/space', payload: { name: 'X' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/space/logo' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: owner } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/space/admins', payload: { userId: owner, admin: true } }))
        .statusCode,
    ).toBe(401);
  });

  it('renames the space and edits the description via PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/space',
      payload: { name: 'Acme HQ', description: 'Where Acme plans launches' },
      ...as(owner),
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json();
    expect(dto.name).toBe('Acme HQ');
    expect(dto.description).toBe('Where Acme plans launches');
    // The rename is the log's source of truth and synced into the registry.
    expect(space.state.spaceName).toBe('Acme HQ');
    expect(space.name).toBe('Acme HQ');
  });

  it('uploads a logo, reflects it in the DTO, and serves the bytes back', async () => {
    const upload = multipartImage(PNG_BYTES, 'image/png');
    const res = await app.inject({ method: 'POST', url: '/api/space/logo', ...upload, ...as(owner) });
    expect(res.statusCode).toBe(200);
    const dto = res.json();
    expect(dto.logoUrl).toMatch(/^\/api\/space\/logo\?v=[0-9a-f]{12}$/);

    const served = await app.inject({ method: 'GET', url: '/api/space/logo' });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects a non-image logo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/space/logo',
      ...multipartImage(Buffer.from('#!/bin/sh\necho nope'), 'image/png'),
      ...as(owner),
    });
    expect(res.statusCode).toBe(400); // sniffed, not believed
  });

  it('clears the logo via DELETE', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/space/logo', ...as(owner) });
    expect(res.statusCode).toBe(200);
    expect(res.json().logoUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/space/logo' })).statusCode).toBe(404);
  });
});
