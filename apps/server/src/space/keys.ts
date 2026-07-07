// Device-local key custody. One 32-byte master key per device; everything
// else derives from it. Custody, in order of preference:
//   1. FRITH_MASTER_KEY env (64 hex) — set by the desktop shell after
//      unwrapping via Electron safeStorage, or by a deployment.
//   2. master.key file in the data dir (0600) — headless/dev fallback.
// The master key never leaves this machine; sharing keys (the space log key)
// travel inside blind-pairing's encrypted handshake instead.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAGIC = Buffer.from('FRITH1');
const IV_LEN = 12;
const TAG_LEN = 16;

export function resolveMasterKey(dataDir: string): Buffer {
  const env = process.env.FRITH_MASTER_KEY;
  if (env) {
    if (!/^[0-9a-f]{64}$/i.test(env)) throw new Error('FRITH_MASTER_KEY must be 64 hex characters');
    return Buffer.from(env, 'hex');
  }
  const file = path.join(dataDir, 'master.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
    if (key.length !== 32) throw new Error(`${file} is corrupt (expected 64 hex characters)`);
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  console.warn(`[keys] minted ${file} (0600) — dev-grade custody; production uses the OS keychain`);
  return key;
}

/** Key for encrypting local JSON files (the registry). Domain-separated from future derivations. */
export function fileKey(master: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', master, 'frith', 'frith:files:v1', 32));
}

/** FRITH1 magic + 12B IV + AES-256-GCM ciphertext + 16B tag. */
export function encryptJson(key: Buffer, value: unknown): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([MAGIC, iv, ciphertext, cipher.getAuthTag()]);
}

export function isEncrypted(bytes: Buffer): boolean {
  return bytes.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptJson(key: Buffer, bytes: Buffer): unknown {
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = bytes.subarray(bytes.length - TAG_LEN);
  const ciphertext = bytes.subarray(MAGIC.length + IV_LEN, bytes.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as unknown;
}
