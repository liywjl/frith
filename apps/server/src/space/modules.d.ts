// Minimal typings for the Pears-stack modules (no official @types).
declare module 'b4a' {
  export function from(input: string | Uint8Array, encoding?: string): Buffer;
  export function toString(buffer: Uint8Array, encoding?: string): string;
}

declare module 'hyperswarm' {
  import type { Duplex } from 'node:stream';
  interface Discovery {
    flushed(): Promise<void>;
  }
  export default class Hyperswarm {
    join(topic: Buffer, opts?: { server?: boolean; client?: boolean }): Discovery;
    on(event: 'connection', listener: (socket: Duplex) => void): this;
    destroy(): Promise<void>;
  }
}

declare module 'corestore' {
  import type { Duplex } from 'node:stream';
  export interface StoreCore {
    readonly key: Buffer;
    length: number;
    ready(): Promise<void>;
    get(index: number): Promise<unknown>;
    has(index: number): Promise<boolean>;
    clear(start: number, end?: number): Promise<unknown>;
    append(value: unknown): Promise<void>;
    on(event: 'append', listener: () => void): void;
    on(event: 'truncate', listener: (to: number) => void): void;
  }
  export default class Corestore {
    constructor(storage: string);
    get(opts: { name: string; valueEncoding?: string } | Buffer): StoreCore;
    replicate(stream: Duplex | boolean): Duplex;
    close(): Promise<void>;
  }
}

declare module 'hyperblobs' {
  import type { StoreCore } from 'corestore';
  export default class Hyperblobs {
    constructor(core: StoreCore);
    readonly core: StoreCore;
    put(bytes: Buffer): Promise<unknown>;
    get(id: unknown, opts?: { timeout?: number; wait?: boolean }): Promise<Buffer | null>;
  }
}

declare module 'blind-pairing' {
  import type Hyperswarm from 'hyperswarm';

  interface Candidate {
    userData: Buffer;
    open(publicKey: Buffer): void;
    confirm(data: { key: Buffer }): void;
  }
  interface Member {
    flushed(): Promise<void>;
  }
  interface CandidateHandle {
    pairing: Promise<unknown>;
  }

  export default class BlindPairing {
    constructor(swarm: Hyperswarm, opts?: { poll?: number });
    static createInvite(key: Buffer): { invite: Buffer; publicKey: Buffer; discoveryKey: Buffer };
    addMember(opts: { discoveryKey: Buffer; onadd(candidate: Candidate): void | Promise<void> }): Member;
    addCandidate(opts: {
      invite: Buffer;
      userData: Buffer;
      onadd?(result: { key: Buffer }): void | Promise<void>;
    }): CandidateHandle;
    close(): Promise<void>;
  }
}

declare module 'autobase' {
  import type Corestore from 'corestore';
  import type { StoreCore } from 'corestore';

  interface ApplyHost {
    addWriter(key: Buffer, opts?: { indexer?: boolean }): Promise<void>;
  }
  interface AppliedNode {
    value: unknown;
    from: { key: Buffer };
  }
  export interface AutobaseOptions {
    valueEncoding?: string;
    optimistic?: boolean;
    ackInterval?: number;
    open(viewStore: Corestore): StoreCore;
    apply(nodes: AppliedNode[], view: StoreCore, host: ApplyHost): Promise<void>;
  }

  export default class Autobase {
    constructor(store: Corestore, bootstrap: Buffer | null, opts: AutobaseOptions);
    /** Derive the local writer core for a store before opening the base. */
    static getLocalCore(store: Corestore): StoreCore & { key: Buffer };
    readonly key: Buffer;
    readonly discoveryKey: Buffer;
    readonly writable: boolean;
    readonly length: number;
    readonly signedLength: number;
    readonly view: StoreCore;
    ready(): Promise<void>;
    update(): Promise<void>;
    append(value: unknown, opts?: { optimistic?: boolean }): Promise<void>;
    close(): Promise<void>;
  }
}
