// End-to-end eviction through the real Space instance: minting the initial key
// on owner bind, rotating on eviction, and rolling the invite. Runs against a
// live (test-mode, no swarm) Space with its encrypted registry on disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import b4a from 'b4a';
import hypercoreCrypto from 'hypercore-crypto';

const scratch = path.join(os.tmpdir(), `frith-evict-${process.pid}`);
process.env.FRITH_DATA = path.join(scratch, 'space');

const { buildApp } = await import('../src/api/routes.js');
const { space } = await import('../src/space/space.js');
const { deviceBindingMessage } = await import('../src/space/state.js');
const { deviceEncKeyPair } = await import('../src/space/crypto.js');

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

/** Craft a second member's root-vouched device binding and append it. */
async function admitMember(): Promise<{ userId: string; deviceKey: string; enc: ReturnType<typeof deviceEncKeyPair> }> {
  const seed = crypto.randomBytes(32);
  const pair = hypercoreCrypto.keyPair(seed);
  const userId = crypto.randomUUID();
  const deviceKey = crypto.randomBytes(32).toString('hex');
  const enc = deviceEncKeyPair();
  await space.append({ t: 'identity', userId, rootKey: b4a.toString(pair.publicKey, 'hex') });
  const sig = b4a.toString(
    hypercoreCrypto.sign(b4a.from(deviceBindingMessage(userId, deviceKey, enc.publicKey)), pair.secretKey),
    'hex',
  );
  await space.append({ t: 'device', userId, deviceKey, encPubKey: enc.publicKey, sig });
  return { userId, deviceKey, enc };
}

describe('Space.evictUser', () => {
  it('mints a space content key when the owner binds', () => {
    expect(space.state.ownerUserId).toBe(owner);
    expect(space.state.currentKeyId('space')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rotates the content key and invite, sealing the new key away from the evictee', async () => {
    const bea = await admitMember();
    const keyBefore = space.state.currentKeyId('space')!;
    const inviteBefore = space.invite();

    await space.evictUser(bea.userId, owner);

    // The user is out: evicted, devices revoked, memberships gone.
    expect(space.state.evicted.has(bea.userId)).toBe(true);
    expect(space.state.revokedDevices.has(bea.deviceKey)).toBe(true);
    expect(space.state.deviceOwners.has(bea.deviceKey)).toBe(false);

    // A fresh current key that the owner holds but the evictee was not sealed into.
    const keyAfter = space.state.currentKeyId('space')!;
    expect(keyAfter).not.toBe(keyBefore);
    const wraps = space.state.domains.get('space')!.get(keyAfter)!.wraps;
    expect(wraps[bea.deviceKey]).toBeUndefined();
    expect(wraps[space.localDeviceKey()]).toBeDefined();

    // The invite is rolled, so the old QR/link can't re-admit them.
    expect(space.invite()).not.toBe(inviteBefore);
  });

  it('encrypts new messages under the post-eviction key, unreadable to the evictee', async () => {
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'secure', type: 'public' } })
    ).json().channelId as string;
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: 'after you left' },
      cookies: { uid: owner },
    });
    const stored = [...space.state.messages.values()].find((m) => m.channelId === channel)!;
    // Sealed under the current key; the owner (a holder) reads it back.
    expect(stored.body.startsWith('frithc1:')).toBe(true);
    expect(space.decryptBody(stored.body)).toBe('after you left');
  });
});

const as = (userId: string) => ({ cookies: { uid: userId } });

describe('per-channel domains', () => {
  let channelId: string;

  it('gives a private channel its own keychain, distinct from the space key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { name: 'skunkworks', type: 'private' },
      ...as(owner),
    });
    channelId = res.json().channelId as string;
    const domain = `channel:${channelId}` as const;
    const channelKey = space.state.currentKeyId(domain);
    expect(channelKey).toMatch(/^[0-9a-f]{64}$/);
    expect(channelKey).not.toBe(space.state.currentKeyId('space'));

    await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/messages`,
      payload: { body: 'members only' },
      ...as(owner),
    });
    const stored = [...space.state.messages.values()].find((m) => m.channelId === channelId)!;
    // Encrypted under the CHANNEL key, not the space key.
    expect(stored.body.split(':')[1]).toBe(channelKey);
    expect(space.decryptBody(stored.body)).toBe('members only');
  });

  it('grants the channel key when a member joins, and rotates it away on removal', async () => {
    const cass = await admitMember();
    // Give the crafted identity a user row so membership ops accept it.
    await space.append({ t: 'user', id: cass.userId, patch: { handle: `h${cass.userId.slice(0, 6)}`, name: 'Cass' } });

    const domain = `channel:${channelId}` as const;
    const keyBefore = space.state.currentKeyId(domain)!;

    await app.inject({ method: 'POST', url: `/api/channels/${channelId}/members`, payload: { userId: cass.userId }, ...as(owner) });
    // Joining sealed the channel key to Cass's device (full history default).
    const wrap = space.state.domains.get(domain)!.get(keyBefore)!.wraps[cass.deviceKey]!;
    const { openKey } = await import('../src/space/crypto.js');
    expect(openKey(wrap, keyBefore, cass.enc)).toMatch(/^[0-9a-f]{64}$/);

    await app.inject({ method: 'DELETE', url: `/api/channels/${channelId}/members/${cass.userId}`, ...as(owner) });
    // Removal rotated the channel key; the new key is not sealed to Cass.
    const keyAfter = space.state.currentKeyId(domain)!;
    expect(keyAfter).not.toBe(keyBefore);
    expect(space.state.domains.get(domain)!.get(keyAfter)!.wraps[cass.deviceKey]).toBeUndefined();
    // The space key did NOT rotate — removal was channel-scoped.
    expect(space.state.evicted.has(cass.userId)).toBe(false);
  });
});

describe('blob purge on eviction (HARDENING §4)', () => {
  // The byte-removal mechanics of BlobStore.drop are proven in blobs.test.ts;
  // these prove the wiring — which refs get dropped when an evict op applies.
  const blobId = { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 8 };
  const msgFor = (userId: string, id: string) => ({
    t: 'msg' as const,
    message: {
      id,
      channelId: 'c-purge',
      authorId: userId,
      parentMessageId: null,
      body: 'x',
      createdAt: new Date().toISOString(),
    },
  });
  const attFor = (messageId: string, id: string, key: string) => ({
    t: 'att' as const,
    attachment: { id, messageId, name: 'f.bin', mime: 'application/octet-stream', size: 8, blob: { key, id: blobId } },
  });

  it('drops the evicted author’s cached blobs — and only theirs', async () => {
    const evictee = await admitMember();
    const bystander = await admitMember();
    const evicteeCore = crypto.randomBytes(32).toString('hex');
    const bystanderCore = crypto.randomBytes(32).toString('hex');
    await space.append(msgFor(evictee.userId, 'm-purge-1'));
    await space.append(attFor('m-purge-1', 'att-purge-1', evicteeCore));
    await space.append(msgFor(bystander.userId, 'm-purge-2'));
    await space.append(attFor('m-purge-2', 'att-purge-2', bystanderCore));

    const drop = vi.spyOn(space.blobs, 'drop').mockResolvedValue(undefined);
    try {
      await space.evictUser(evictee.userId, owner);
      const dropped = drop.mock.calls.map(([ref]) => ref.key);
      expect(dropped).toContain(evicteeCore);
      expect(dropped).not.toContain(bystanderCore);
    } finally {
      drop.mockRestore();
    }
  });

  it('ignores a forged evict op — no grief-purge', async () => {
    const target = await admitMember();
    const core = crypto.randomBytes(32).toString('hex');
    await space.append(msgFor(target.userId, 'm-purge-3'));
    await space.append(attFor('m-purge-3', 'att-purge-3', core));
    const drop = vi.spyOn(space.blobs, 'drop').mockResolvedValue(undefined);
    try {
      await space.append({ t: 'evict', userId: target.userId, actorId: owner, sig: 'ab'.repeat(64) });
      expect(space.state.evicted.has(target.userId)).toBe(false);
      expect(drop).not.toHaveBeenCalled();
    } finally {
      drop.mockRestore();
    }
  });
});

describe('fingerprint verification (HARDENING §6)', () => {
  it('gives both sides the same code; the mark drops if the root key changes', async () => {
    const { fingerprintCode, fingerprintFor, setContactVerified } = await import('../src/domain/contacts.js');
    const contact = await admitMember();
    const code = fingerprintCode(owner, contact.userId)!;
    expect(code).toMatch(/^(\d{5} ){7}\d{5}$/); // 40 digits, spoken-size groups
    expect(fingerprintCode(contact.userId, owner)).toBe(code); // order-independent

    expect(fingerprintFor(owner, contact.userId).verified).toBe(false);
    expect(setContactVerified(owner, contact.userId, true).verified).toBe(true);
    expect(fingerprintFor(owner, contact.userId).verified).toBe(true);

    // A re-rooted contact is a different identity: the stored mark vouched
    // for the old code, so verification silently drops. (Roots are immutable
    // through ops — mutate the map directly to simulate.)
    const oldRoot = space.state.roots.get(contact.userId)!;
    space.state.roots.set(contact.userId, 'ff'.repeat(32));
    expect(fingerprintFor(owner, contact.userId).verified).toBe(false);
    space.state.roots.set(contact.userId, oldRoot);

    // Served over the API for the signed-in viewer.
    const res = await app.inject({ method: 'GET', url: `/api/contacts/${contact.userId}/fingerprint`, ...as(owner) });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe(code);
  });
});

describe('content encryption end-to-end', () => {
  it('stores scheduled messages encrypted and lists them decrypted', async () => {
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'sched-test', type: 'public' } })
    ).json().channelId as string;
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/schedule`,
      payload: { body: 'later, secretly', inMinutes: 60 },
      ...as(owner),
    });
    const row = [...space.state.scheduled.values()].find((s) => s.channelId === channel)!;
    expect(row.body.startsWith('frithc1:')).toBe(true); // encrypted in the log
    const listed = (await app.inject({ method: 'GET', url: '/api/scheduled', ...as(owner) })).json() as {
      body: string;
    }[];
    expect(listed.some((s) => s.body === 'later, secretly')).toBe(true); // decrypted for the author
  });

  it('seals shared-doc titles and bodies under the space key', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/docs',
      payload: { title: 'Secret runbook' },
      ...as(owner),
    });
    const doc = created.json() as { id: string };
    await app.inject({
      method: 'PUT',
      url: `/api/docs/${doc.id}`,
      payload: { body: 'rotate the rutabaga key' },
      ...as(owner),
    });
    const stored = space.state.docs.get(doc.id)!;
    expect(stored.title.startsWith('frithc1:')).toBe(true);
    expect(stored.body.startsWith('frithc1:')).toBe(true);
    expect(stored.body).not.toContain('rutabaga');
    // …and the API hands it back decrypted to a member.
    const read = await app.inject({ method: 'GET', url: `/api/docs/${doc.id}`, ...as(owner) });
    expect(read.json().body).toBe('rotate the rutabaga key');
  });

  it('search finds tokens inside encrypted messages', async () => {
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'ask-test', type: 'public' } })
    ).json().channelId as string;
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/messages`,
      payload: { body: 'the kumquat launch is friday' },
      ...as(owner),
    });
    const res = (await app.inject({ method: 'GET', url: '/api/ask?q=kumquat', ...as(owner) })).json() as {
      messages: { snippet: string }[];
    };
    expect(res.messages.some((m) => m.snippet.includes('kumquat'))).toBe(true);
  });

  it('lets the owner evict even when the device is bound to a newer profile', async () => {
    // Onboarding a second profile REBINDS this device to it — the old
    // writer-coupled authorization would break here; actorId auth must not.
    await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'Newer', handle: 'newer' } });
    const target = await admitMember();
    const res = await app.inject({ method: 'POST', url: '/api/space/evict', payload: { userId: target.userId }, ...as(owner) });
    expect(res.statusCode).toBe(200);
    expect(space.state.evicted.has(target.userId)).toBe(true);
  });

  it('seals attachment bytes on disk and serves them decrypted — never plaintext at rest', async () => {
    const canary = 'attachment-canary-bytes-must-not-hit-disk';
    const channel = (
      await app.inject({ method: 'POST', url: '/api/dev/channel', payload: { name: 'files-test', type: 'public' } })
    ).json().channelId as string;
    const boundary = 'frith-evict-boundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nnotes\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      Buffer.from(canary),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
      method: 'POST',
      url: `/api/channels/${channel}/attachments`,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      ...as(owner),
    });
    expect(up.statusCode).toBe(200);
    const attachment = up.json().attachments[0] as { id: string; name: string };
    expect(attachment.name).toBe('notes.txt'); // name decrypted in the DTO

    // The blob itself is a sealed envelope — content-key encryption on top of
    // the block layer, so an evicted-but-replicating device reads FRITHB1, not text.
    const row = [...space.state.attachments.values()].find((a) => a.id === attachment.id)!;
    const raw = await space.blobs.get(row.blob!, { expectedHash: row.hash });
    expect(raw!.subarray(0, 7).toString()).toBe('FRITHB1');
    expect(raw!.includes(canary)).toBe(false);
    expect(row.name.startsWith('frithc1:')).toBe(true); // filename sealed too

    // Served bytes come back decrypted…
    const dl = await app.inject({ method: 'GET', url: `/api/files/${attachment.id}`, ...as(owner) });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.toString('utf8')).toBe(canary);

    // …but the canary never touches disk in the clear. (Close flushes cores;
    // afterAll's close tolerates the second call.)
    await space.close();
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (fs.readFileSync(p).includes(canary)) hits.push(p);
      }
    };
    walk(process.env.FRITH_DATA!);
    expect(hits).toEqual([]);
  });
});
