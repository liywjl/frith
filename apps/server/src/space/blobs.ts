// Attachment bytes, peer-to-peer. Each instance appends its uploads to its
// own Hyperblobs core inside the space's corestore; the att op records the
// core key + blob id. Peers fetch blocks sparsely over the same replication
// streams the log uses — bytes move only when someone asks for them, and a
// device-local budget evicts least-recently-used remote blocks.
import crypto from 'node:crypto';
import fs from 'node:fs';
import Hyperblobs from 'hyperblobs';
import type Corestore from 'corestore';
import b4a from 'b4a';
import type { BlobId } from './state.js';

export interface BlobRef {
  key: string; // hex core key of the holding instance's blob core
  id: BlobId;
}

interface CacheEntry {
  ref: BlobRef;
  bytes: number;
  lastAccess: number; // ms epoch
}

const cacheKeyOf = (ref: BlobRef) => `${ref.key}:${ref.id.blockOffset}`;

export class BlobStore {
  private store: Corestore;
  private own: Hyperblobs;
  private remotes = new Map<string, Hyperblobs>();
  private cacheFile: string;
  /** Evictable remote blobs held locally, LRU bookkeeping. */
  private cache = new Map<string, CacheEntry>();

  constructor(store: Corestore, cacheFile: string) {
    this.store = store;
    this.own = new Hyperblobs(store.get({ name: 'blobs' }));
    this.cacheFile = cacheFile;
    try {
      this.cache = new Map(Object.entries(JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))));
    } catch {
      // fresh instance — empty cache
    }
  }

  async ready(): Promise<void> {
    await this.own.core.ready();
  }

  ownKey(): string {
    return b4a.toString(this.own.core.key, 'hex');
  }

  static hash(bytes: Buffer): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  /** Append bytes to this instance's blob core. */
  async put(bytes: Buffer): Promise<{ ref: BlobRef; hash: string }> {
    const id = (await this.own.put(bytes)) as BlobId;
    return { ref: { key: this.ownKey(), id }, hash: BlobStore.hash(bytes) };
  }

  private blobsFor(ref: BlobRef): Hyperblobs {
    if (this.isOwn(ref)) return this.own;
    let blobs = this.remotes.get(ref.key);
    if (!blobs) {
      blobs = new Hyperblobs(this.store.get(b4a.from(ref.key, 'hex')));
      this.remotes.set(ref.key, blobs);
    }
    return blobs;
  }

  isOwn(ref: BlobRef): boolean {
    return ref.key === this.ownKey();
  }

  /** Sync view of isCached from LRU bookkeeping — for DTO shaping. */
  isCachedSync(ref: BlobRef): boolean {
    return this.isOwn(ref) || this.cache.has(cacheKeyOf(ref));
  }

  /** Bytes available locally without asking a peer? */
  async isCached(ref: BlobRef): Promise<boolean> {
    if (this.isOwn(ref)) return true;
    const core = this.blobsFor(ref).core;
    await core.ready();
    for (let i = ref.id.blockOffset; i < ref.id.blockOffset + ref.id.blockLength; i++) {
      if (!(await core.has(i))) return false;
    }
    return true;
  }

  /**
   * Read a blob. Own blobs come straight from our core; remote ones from the
   * local cache, or — when `wait` is set — from whichever peer holds them,
   * within timeoutMs. Returns null when the bytes aren't available on those
   * terms, or when they fail hash verification.
   */
  async get(
    ref: BlobRef,
    opts: { wait?: boolean; timeoutMs?: number; expectedHash?: string } = {},
  ): Promise<Buffer | null> {
    if (!this.isOwn(ref) && !opts.wait && !(await this.isCached(ref))) return null;
    let bytes: Buffer | null;
    try {
      bytes = (await this.blobsFor(ref).get(ref.id, {
        timeout: opts.wait ? (opts.timeoutMs ?? 15_000) : 1_000,
      })) as Buffer | null;
    } catch {
      return null; // timeout / channel closed — no peer holding it is reachable
    }
    if (!bytes) return null;
    // Hypercore already merkle-verifies each block against the writer's tree;
    // this checks the writer told the truth about what the blob is.
    if (opts.expectedHash && BlobStore.hash(bytes) !== opts.expectedHash) {
      await this.drop(ref).catch(() => {});
      return null;
    }
    if (!this.isOwn(ref)) {
      this.cache.set(cacheKeyOf(ref), { ref, bytes: bytes.length, lastAccess: Date.now() });
      this.persist();
    }
    return bytes;
  }

  /** Forget a remote blob's local blocks (eviction / failed verification). */
  async drop(ref: BlobRef): Promise<void> {
    if (this.isOwn(ref)) return; // never evict our own uploads — we're their origin
    const core = this.blobsFor(ref).core;
    await core.ready();
    await core.clear(ref.id.blockOffset, ref.id.blockOffset + ref.id.blockLength);
    this.cache.delete(cacheKeyOf(ref));
    this.persist();
  }

  usage(): { cachedBytes: number; cachedCount: number } {
    let bytes = 0;
    for (const entry of this.cache.values()) bytes += entry.bytes;
    return { cachedBytes: bytes, cachedCount: this.cache.size };
  }

  /** Evict least-recently-used remote blobs until under the budget. */
  async enforceBudget(budgetBytes: number): Promise<void> {
    let total = this.usage().cachedBytes;
    const oldestFirst = [...this.cache.values()].sort((a, b) => a.lastAccess - b.lastAccess);
    for (const entry of oldestFirst) {
      if (total <= budgetBytes) break;
      await this.drop(entry.ref).catch(() => {});
      total -= entry.bytes;
    }
  }

  async clearCache(): Promise<void> {
    await this.enforceBudget(0);
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(Object.fromEntries(this.cache)));
    } catch {
      // best-effort bookkeeping — worst case we re-fetch or under-count
    }
  }
}
