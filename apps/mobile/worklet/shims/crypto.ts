// node:crypto for the Bare worklet — only what the server's space/ layer
// uses, byte-compatible with Node so a space's registry, content envelopes,
// and blob seals open identically on desktop and mobile:
//   randomBytes, randomUUID, createHash('sha256'), hkdfSync('sha256', …),
//   createCipheriv/createDecipheriv('aes-256-gcm').
// AES-GCM and hashing come from the audited pure-JS noble libraries;
// randomness from sodium via hypercore-crypto (already in the bundle).
import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';

type Bytes = Uint8Array;

const toBytes = (value: string | Bytes, encoding: string = 'utf8'): Buffer =>
  typeof value === 'string' ? b4a.from(value, encoding as 'utf8') : b4a.from(value);

// randomBytes exists at runtime (sodium randombytes_buf) but isn't in the
// repo's minimal hypercore-crypto typings.
const sodiumRandom = (hypercoreCrypto as unknown as { randomBytes(size: number): Buffer }).randomBytes;

export function randomBytes(size: number): Buffer {
  return sodiumRandom(size);
}

export function randomUUID(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const hex = b4a.toString(b, 'hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class Hash {
  private h = sha256.create();
  update(data: string | Bytes, encoding?: string): this {
    this.h.update(toBytes(data, encoding));
    return this;
  }
  digest(): Buffer;
  digest(encoding: 'hex'): string;
  digest(encoding?: string): Buffer | string {
    const out = b4a.from(this.h.digest());
    return encoding === 'hex' ? b4a.toString(out, 'hex') : out;
  }
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== 'sha256') throw new Error(`crypto shim: unsupported hash ${algorithm}`);
  return new Hash();
}

export function hkdfSync(
  digest: string,
  ikm: string | Bytes,
  salt: string | Bytes,
  info: string | Bytes,
  keylen: number,
): ArrayBuffer {
  if (digest !== 'sha256') throw new Error(`crypto shim: unsupported hkdf digest ${digest}`);
  const out = hkdf(sha256, toBytes(ikm), toBytes(salt), toBytes(info), keylen);
  // Node returns an ArrayBuffer here (callers wrap it in Buffer.from).
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

const TAG_LEN = 16;

// Node's streaming cipher API over noble's one-shot GCM: buffer the updates,
// seal/open at final(). Every caller in space/ concatenates update()+final()
// output, so returning it all from final() is behavior-identical.
class CipherGcm {
  private chunks: Buffer[] = [];
  private tag: Buffer | null = null;
  constructor(
    private key: Buffer,
    private iv: Buffer,
  ) {}
  update(data: string | Bytes, encoding?: string): Buffer {
    this.chunks.push(toBytes(data, encoding));
    return b4a.alloc(0);
  }
  final(): Buffer {
    const sealed = b4a.from(gcm(this.key, this.iv).encrypt(b4a.concat(this.chunks)));
    this.tag = sealed.subarray(sealed.length - TAG_LEN);
    return sealed.subarray(0, sealed.length - TAG_LEN);
  }
  getAuthTag(): Buffer {
    if (!this.tag) throw new Error('getAuthTag before final');
    return this.tag;
  }
}

class DecipherGcm {
  private chunks: Buffer[] = [];
  private tag: Buffer = b4a.alloc(0);
  constructor(
    private key: Buffer,
    private iv: Buffer,
  ) {}
  setAuthTag(tag: Bytes): this {
    this.tag = b4a.from(tag);
    return this;
  }
  update(data: string | Bytes, encoding?: string): Buffer {
    this.chunks.push(toBytes(data, encoding));
    return b4a.alloc(0);
  }
  final(): Buffer {
    // noble expects ciphertext||tag and throws on tampering, like Node.
    return b4a.from(gcm(this.key, this.iv).decrypt(b4a.concat([...this.chunks, this.tag])));
  }
}

function assertGcm(algorithm: string, key: Bytes): Buffer {
  if (algorithm !== 'aes-256-gcm') throw new Error(`crypto shim: unsupported cipher ${algorithm}`);
  const k = b4a.from(key);
  if (k.length !== 32) throw new Error('aes-256-gcm needs a 32-byte key');
  return k;
}

export function createCipheriv(algorithm: string, key: Bytes, iv: Bytes): CipherGcm {
  return new CipherGcm(assertGcm(algorithm, key), b4a.from(iv));
}

export function createDecipheriv(algorithm: string, key: Bytes, iv: Bytes): DecipherGcm {
  return new DecipherGcm(assertGcm(algorithm, key), b4a.from(iv));
}

export default { randomBytes, randomUUID, createHash, hkdfSync, createCipheriv, createDecipheriv };
