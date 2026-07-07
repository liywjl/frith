import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import b4a from 'b4a';
import hypercoreCrypto from 'hypercore-crypto';

// Own scratch space — this file exercises identity + encryption, not the
// fixtures api.test.ts builds.
const scratch = path.join(os.tmpdir(), `frith-identity-${process.pid}`);
process.env.FRITH_DATA = path.join(scratch, 'space');

const { buildApp } = await import('../src/api/routes.js');
const { space } = await import('../src/space/space.js');
const { deviceBindingMessage } = await import('../src/space/state.js');

let app: FastifyInstance;
let mika: string; // profile created through the real onboarding path

beforeAll(async () => {
  fs.rmSync(scratch, { recursive: true, force: true });
  app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    payload: { name: 'Mika', handle: 'mika' },
  });
  mika = res.json().id as string;
});

afterAll(async () => {
  await app.close();
  await space.close();
});

const as = (userId: string) => ({ cookies: { uid: userId } });

describe('identity: root keys certify device keys', () => {
  it('binds this device to a new profile at creation', () => {
    expect(space.state.roots.get(mika)).toMatch(/^[0-9a-f]{64}$/);
    expect(space.state.deviceOwners.get(space.localDeviceKey())).toBe(mika);
  });

  it('marks messages from the bound author as verified', async () => {
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'general', type: 'public' } })
    ).json().channelId as string;
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: 'signed by my device' },
      ...as(mika),
    });
    const messages = [...space.state.messages.values()].filter((m) => m.channelId === channel);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.verified).toBe(true);
  });

  it('marks messages whose author does not own the device as unverified', async () => {
    // Dev-seeded users have no identity — the device stays bound to mika.
    const imposter = (
      await app.inject({ method: 'POST', url: '/api/dev/user', payload: { handle: 'imp', name: 'Imposter' } })
    ).json().id as string;
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'spoof', type: 'public' } })
    ).json().channelId as string;
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: 'trust me, i am imposter' },
      ...as(imposter),
    });
    const messages = [...space.state.messages.values()].filter((m) => m.channelId === channel);
    expect(messages[0]!.verified).toBe(false);
  });

  it('ignores device bindings with bad signatures', async () => {
    const rogueDevice = 'e0'.repeat(32);
    await space.append({ t: 'device', userId: mika, deviceKey: rogueDevice, sig: 'f1'.repeat(64) });
    expect(space.state.deviceOwners.has(rogueDevice)).toBe(false);
  });

  it('first root wins — a second identity op for the same user is ignored', async () => {
    const before = space.state.roots.get(mika)!;
    await space.append({ t: 'identity', userId: mika, rootKey: 'a7'.repeat(32) });
    expect(space.state.roots.get(mika)).toBe(before);
  });

  it('exports a handoff code and re-imports it', async () => {
    const exported = await app.inject({ method: 'GET', url: '/api/identity/export', ...as(mika) });
    expect(exported.statusCode).toBe(200);
    const code = exported.json().code as string;
    expect(code).toMatch(/^frith-id:/);

    const imported = await app.inject({ method: 'POST', url: '/api/identity/import', payload: { code } });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().userId).toBe(mika);
  });

  it('rejects an import whose seed does not match the on-log root', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/identity/import',
      payload: { code: `frith-id:${mika}:${'99'.repeat(32)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('revocation is sticky — a replayed binding cannot resurrect the device', async () => {
    // A second device, certified with the real root seed…
    const seed = (await app.inject({ method: 'GET', url: '/api/identity/export', ...as(mika) }))
      .json()
      .code.split(':')[2] as string;
    const pair = hypercoreCrypto.keyPair(b4a.from(seed, 'hex'));
    const stolen = 'd4'.repeat(32);
    const sig = b4a.toString(hypercoreCrypto.sign(b4a.from(deviceBindingMessage(mika, stolen)), pair.secretKey), 'hex');
    await space.append({ t: 'device', userId: mika, deviceKey: stolen, sig });
    expect(space.state.deviceOwners.get(stolen)).toBe(mika);

    // …reported stolen and revoked…
    const res = await app.inject({
      method: 'POST',
      url: '/api/identity/devices/revoke',
      payload: { deviceKey: stolen },
      ...as(mika),
    });
    expect(res.statusCode).toBe(200);
    expect(space.state.deviceOwners.has(stolen)).toBe(false);

    // …and replaying the original (validly signed) binding changes nothing.
    await space.append({ t: 'device', userId: mika, deviceKey: stolen, sig });
    expect(space.state.deviceOwners.has(stolen)).toBe(false);
  });
});

describe('encryption at rest', () => {
  it('stores the registry encrypted, with no secrets in the raw bytes', () => {
    const raw = fs.readFileSync(path.join(process.env.FRITH_DATA!, 'spaces.json'));
    expect(raw.subarray(0, 6).toString()).toBe('FRITH1');
    expect(raw.includes('invite')).toBe(false);
  });

  it('leaves no message plaintext in the space log on disk', async () => {
    const canary = 'seekrit-canary-string-that-must-not-hit-disk';
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'enc', type: 'public' } })
    ).json().channelId as string;
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: canary },
      ...as(mika),
    });
    // The stored body is a content-key envelope, not the text — and a holder
    // of the key can still decrypt it back to the canary.
    const stored = [...space.state.messages.values()].find((m) => m.channelId === channel);
    expect(stored, 'the message should be stored encrypted').toBeDefined();
    expect(stored!.body).not.toContain(canary);
    expect(space.decryptBody(stored!.body)).toBe(canary);
    await space.close(); // flush cores; afterAll's close tolerates a second call

    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (fs.readFileSync(p).includes(canary)) hits.push(p);
      }
    };
    walk(process.env.FRITH_DATA!);
    expect(hits).toEqual([]); // …but never on disk in the clear
  });
});
