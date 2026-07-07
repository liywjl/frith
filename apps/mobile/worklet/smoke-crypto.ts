// Cross-runtime crypto proof (runs under Node only): a space's encrypted
// registry, content envelopes, and sealed blobs written by the desktop
// (node:crypto) must open on mobile (the shim) and vice versa. The shim is
// pure JS, so both implementations run here side by side.
import nodeCrypto from 'node:crypto';
import b4a from 'b4a';
import shim from './shims/crypto.js';
import { openContent, sealContent, openBytes, sealBytes } from '../../server/src/space/crypto.js';
import { decryptJson, encryptJson } from '../../server/src/space/keys.js';

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  console.log(`ok — ${label}`);
}

export function crossCheckCrypto(): void {
  // sha256 + hkdf agree byte for byte.
  const data = b4a.from('the same bytes on every device', 'utf8');
  assert(
    shim.createHash('sha256').update(data).digest('hex') === nodeCrypto.createHash('sha256').update(data).digest('hex'),
    'sha256: shim matches node',
  );
  const master = shim.randomBytes(32);
  const nodeHkdf = Buffer.from(nodeCrypto.hkdfSync('sha256', master, 'frith', 'frith:files:v1', 32));
  const shimHkdf = Buffer.from(shim.hkdfSync('sha256', master, 'frith', 'frith:files:v1', 32));
  assert(nodeHkdf.equals(shimHkdf), 'hkdf: shim derives the same file key');

  // AES-256-GCM both directions, via the exact streaming API space/ uses.
  const key = shim.randomBytes(32);
  const iv = shim.randomBytes(12);
  const plaintext = 'institutional memory, sealed';

  const nodeCipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const nodeSealed = Buffer.concat([nodeCipher.update(plaintext, 'utf8'), nodeCipher.final()]);
  const shimOpen = shim.createDecipheriv('aes-256-gcm', key, iv);
  shimOpen.setAuthTag(nodeCipher.getAuthTag());
  shimOpen.update(nodeSealed);
  assert(shimOpen.final().toString('utf8') === plaintext, 'aes-gcm: shim opens node ciphertext');

  const shimCipher = shim.createCipheriv('aes-256-gcm', key, iv);
  shimCipher.update(plaintext, 'utf8');
  const shimSealed = shimCipher.final();
  const nodeOpen = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  nodeOpen.setAuthTag(shimCipher.getAuthTag());
  assert(
    Buffer.concat([nodeOpen.update(shimSealed), nodeOpen.final()]).toString('utf8') === plaintext,
    'aes-gcm: node opens shim ciphertext',
  );

  // Tampering still explodes.
  const tampered = shim.createDecipheriv('aes-256-gcm', key, iv);
  tampered.setAuthTag(shim.randomBytes(16));
  tampered.update(nodeSealed);
  let threw = false;
  try {
    tampered.final();
  } catch {
    threw = true;
  }
  assert(threw, 'aes-gcm: shim rejects a forged auth tag');

  // The real formats end to end (these run on node:crypto here; under Bare the
  // same code paths run on the shim — the primitives were proven equal above).
  const keyHex = b4a.toString(shim.randomBytes(32), 'hex');
  assert(openContent(keyHex, sealContent(keyHex, plaintext)) === plaintext, 'content envelope round-trips');
  const blob = shim.randomBytes(1024);
  assert(openBytes(keyHex, sealBytes(keyHex, blob))?.equals(blob), 'sealed blob round-trips');
  const fileKey = shim.randomBytes(32);
  assert(
    (decryptJson(fileKey, encryptJson(fileKey, { spaces: [1, 2, 3] })) as { spaces: number[] }).spaces.length === 3,
    'encrypted registry round-trips',
  );

  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(shim.randomUUID()), 'randomUUID shape');
}
