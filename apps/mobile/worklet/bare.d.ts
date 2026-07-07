// Ambient typings for the Bare side of the worklet. The Pears modules are
// typed in ../../server/src/space/modules.d.ts (included via tsconfig);
// these add the extra b4a helpers the crypto shim uses (module declarations
// with the same name merge) and the noble subpath modules.
declare module 'b4a' {
  export function alloc(size: number): Buffer;
  export function concat(buffers: Uint8Array[]): Buffer;
}

declare module '@noble/ciphers/aes.js' {
  export function gcm(
    key: Uint8Array,
    nonce: Uint8Array,
  ): { encrypt(plaintext: Uint8Array): Uint8Array; decrypt(ciphertext: Uint8Array): Uint8Array };
}

declare module '@noble/hashes/sha2.js' {
  interface Sha256 {
    update(data: Uint8Array): Sha256;
    digest(): Uint8Array;
  }
  export const sha256: { create(): Sha256; (data: Uint8Array): Uint8Array };
}

declare module '@noble/hashes/hkdf.js' {
  import type { sha256 } from '@noble/hashes/sha2.js';
  export function hkdf(
    hash: typeof sha256,
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Uint8Array;
}
