// Content-key layer: a second encryption layer *above* the space's block key.
//
// The block key (Autobase's `encryptionKey`) is handed to everyone who pairs and
// can never be rotated — an evicted device that keeps replicating still decrypts
// blocks, so it still sees op metadata. To make removal real we encrypt message
// *content* under per-domain "content keys" that rotate on eviction. A content
// key is sealed (X25519, libsodium crypto_box_seal) to each current member
// device's encryption public key and shipped inside `epoch`/`grant` ops; an
// evicted device never receives a wrap for the new key, so new content goes dark.
//
// A key is named by `keyId = hash(key)`. That makes wraps self-verifying: a
// recipient only accepts an unwrapped key whose hash matches the advertised
// keyId, so nobody can inject a false key without already knowing the real one.
import crypto from 'node:crypto';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';

const IV_LEN = 12;
/** Marks a message/attachment string as a content-key envelope. */
const ENVELOPE = 'frithc1';

export interface EncKeyPair {
  publicKey: string; // hex X25519 public
  secretKey: string; // hex X25519 secret
}

/** A device's X25519 keypair. Deterministic from a seed, else random. */
export function deviceEncKeyPair(seedHex?: string): EncKeyPair {
  const pair = seedHex ? hypercoreCrypto.encryptionKeyPair(b4a.from(seedHex, 'hex')) : hypercoreCrypto.encryptionKeyPair();
  return { publicKey: b4a.toString(pair.publicKey, 'hex'), secretKey: b4a.toString(pair.secretKey, 'hex') };
}

export function newContentKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** keyId = sha of the key bytes. Globally self-identifying, collision-free. */
export function keyIdOf(keyHex: string): string {
  return b4a.toString(hypercoreCrypto.hash(b4a.from(keyHex, 'hex')), 'hex');
}

/** Seal an arbitrary hex secret to a device (crypto_box_seal). Used directly
 *  for payloads whose authenticity comes from a signed envelope (invite
 *  rotations); content keys go through sealKey/openKey which add keyId
 *  self-verification on top. */
export function sealSecret(secretHex: string, devicePubKeyHex: string): string {
  return b4a.toString(hypercoreCrypto.encrypt(b4a.from(secretHex, 'hex'), b4a.from(devicePubKeyHex, 'hex')), 'hex');
}

export function openSecret(sealedHex: string, pair: EncKeyPair): string | null {
  try {
    const out = hypercoreCrypto.decrypt(b4a.from(sealedHex, 'hex'), {
      publicKey: b4a.from(pair.publicKey, 'hex'),
      secretKey: b4a.from(pair.secretKey, 'hex'),
    });
    return out ? b4a.toString(out, 'hex') : null;
  } catch {
    return null;
  }
}

/** Seal a content key to a device's enc public key. */
export const sealKey = sealSecret;

/** Open a sealed key with our device keypair, then verify hash === keyId.
 *  Returns the key hex only if it decrypts AND matches — bogus wraps yield null. */
export function openKey(sealedHex: string, keyId: string, pair: EncKeyPair): string | null {
  const keyHex = openSecret(sealedHex, pair);
  return keyHex !== null && keyIdOf(keyHex) === keyId ? keyHex : null;
}

/** Deterministic digest of a wraps map, bound into epoch/invite signatures so
 *  a malicious writer can't re-publish the op with altered wraps. */
export function wrapsHash(wraps: Record<string, string>): string {
  const canonical = Object.keys(wraps)
    .sort()
    .map((k) => `${k}=${wraps[k]}`)
    .join(',');
  return b4a.toString(hypercoreCrypto.hash(b4a.from(canonical)), 'hex');
}

/** AES-256-GCM encrypt plaintext under a content key, tagged with its keyId. */
export function sealContent(keyHex: string, plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', b4a.from(keyHex, 'hex'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [ENVELOPE, keyIdOf(keyHex), iv.toString('hex'), ct.toString('hex'), cipher.getAuthTag().toString('hex')].join(
    ':',
  );
}

export function isEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE + ':');
}

/** The keyId a content envelope was encrypted under, or null if not an envelope. */
export function envelopeKeyId(value: string): string | null {
  if (!isEnvelope(value)) return null;
  return value.split(':')[1] ?? null;
}

/** Decrypt a content envelope with its key. Throws only on tampering. */
export function openContent(keyHex: string, envelope: string): string {
  const [, , ivHex, ctHex, tagHex] = envelope.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', b4a.from(keyHex, 'hex'), b4a.from(ivHex!, 'hex'));
  decipher.setAuthTag(b4a.from(tagHex!, 'hex'));
  return Buffer.concat([decipher.update(b4a.from(ctHex!, 'hex')), decipher.final()]).toString('utf8');
}

// Binary envelope for blob bytes: magic + keyId(32) + iv(12) + ciphertext + tag(16).
// The blob hash is computed over this envelope, so peer-fetch verification holds.
const BIN_MAGIC = Buffer.from('FRITHB1');

export function sealBytes(keyHex: string, bytes: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', b4a.from(keyHex, 'hex'), iv);
  const ct = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([BIN_MAGIC, b4a.from(keyIdOf(keyHex), 'hex'), iv, ct, cipher.getAuthTag()]);
}

export function isSealedBytes(bytes: Buffer): boolean {
  return bytes.subarray(0, BIN_MAGIC.length).equals(BIN_MAGIC);
}

/** The keyId a sealed blob was encrypted under, or null for legacy plaintext. */
export function sealedBytesKeyId(bytes: Buffer): string | null {
  if (!isSealedBytes(bytes)) return null;
  return bytes.subarray(BIN_MAGIC.length, BIN_MAGIC.length + 32).toString('hex');
}

/** Decrypt a sealed blob. Returns null on a wrong key or tampering. */
export function openBytes(keyHex: string, bytes: Buffer): Buffer | null {
  try {
    const ivStart = BIN_MAGIC.length + 32;
    const iv = bytes.subarray(ivStart, ivStart + IV_LEN);
    const tag = bytes.subarray(bytes.length - 16);
    const ct = bytes.subarray(ivStart + IV_LEN, bytes.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', b4a.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null;
  }
}
