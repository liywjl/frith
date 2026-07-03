// Minimal typings for the Pears-stack modules (no official @types).
declare module 'hyperswarm' {
  import type { Duplex } from 'node:stream';

  export type SwarmSocket = Duplex;

  interface Discovery {
    flushed(): Promise<void>;
  }

  export default class Hyperswarm {
    join(topic: Buffer, opts?: { server?: boolean; client?: boolean }): Discovery;
    on(event: 'connection', listener: (socket: SwarmSocket) => void): this;
    destroy(): Promise<void>;
  }
}

declare module 'b4a' {
  export function from(input: string | Uint8Array, encoding?: string): Buffer;
  export function toString(buffer: Uint8Array, encoding?: string): string;
}

declare module 'hypercore-crypto' {
  export function keyPair(): { publicKey: Buffer; secretKey: Buffer };
  export function sign(message: Buffer, secretKey: Buffer): Buffer;
  export function verify(message: Buffer, signature: Buffer, publicKey: Buffer): boolean;
}
