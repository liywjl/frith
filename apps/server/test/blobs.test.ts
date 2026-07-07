import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import Corestore from 'corestore';
import { BlobStore } from '../src/space/blobs.js';

const scratch = path.join(os.tmpdir(), `frith-blobs-${process.pid}`);

// Two instances wired the way Hyperswarm wires them in production: their
// corestores replicate over a duplex pipe, and blobs move sparsely on demand.
const A = new Corestore(path.join(scratch, 'a'));
const B = new Corestore(path.join(scratch, 'b'));
const blobsA = new BlobStore(A, path.join(scratch, 'a-cache.json'));
const blobsB = new BlobStore(B, path.join(scratch, 'b-cache.json'));

afterAll(async () => {
  await A.close();
  await B.close();
});

describe('BlobStore', () => {
  it('roundtrips own bytes and verifies the content hash', async () => {
    await blobsA.ready();
    const bytes = Buffer.from('what gets stored is what you shared');
    const { ref, hash } = await blobsA.put(bytes);
    expect(blobsA.isOwn(ref)).toBe(true);
    expect(await blobsA.isCached(ref)).toBe(true);
    const back = await blobsA.get(ref, { expectedHash: hash });
    expect(back?.equals(bytes)).toBe(true);
  });

  it('fetches a peer blob sparsely, verifies it, caches it, and evicts it', async () => {
    await blobsA.ready();
    await blobsB.ready();
    const s1 = A.replicate(true);
    const s2 = B.replicate(false);
    s1.pipe(s2).pipe(s1);

    const bytes = Buffer.from('bytes travel peer to peer, on request');
    const { ref, hash } = await blobsA.put(bytes);

    // B doesn't have it until it asks.
    expect(blobsB.isOwn(ref)).toBe(false);
    expect(await blobsB.isCached(ref)).toBe(false);
    expect(await blobsB.get(ref, { wait: false })).toBeNull();

    // Explicit fetch pulls it across and caches it.
    const fetched = await blobsB.get(ref, { wait: true, timeoutMs: 5000, expectedHash: hash });
    expect(fetched?.equals(bytes)).toBe(true);
    expect(await blobsB.isCached(ref)).toBe(true);
    expect(blobsB.usage().cachedBytes).toBeGreaterThan(0);

    // A lying writer: expected hash doesn't match what arrived.
    const poisoned = await blobsB.get(ref, { wait: true, expectedHash: 'deadbeef' });
    expect(poisoned).toBeNull();
    expect(await blobsB.isCached(ref)).toBe(false); // dropped on verification failure

    // Fetch again, then evict via budget.
    await blobsB.get(ref, { wait: true, timeoutMs: 5000, expectedHash: hash });
    await blobsB.enforceBudget(0);
    expect(await blobsB.isCached(ref)).toBe(false);
    expect(blobsB.usage().cachedBytes).toBe(0);

    // Own blobs never evict — A is the origin.
    await blobsA.enforceBudget(0);
    expect(await blobsA.isCached(ref)).toBe(true);
  });
});
