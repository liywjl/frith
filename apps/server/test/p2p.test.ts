import { describe, expect, it } from 'vitest';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import { signFrame, verifyFrame, type WireFrame } from '../src/p2p/bridge.js';

const pair = hypercoreCrypto.keyPair();

function makeFrame(): Omit<WireFrame, 'sig'> {
  return {
    type: 'message',
    origin: b4a.toString(pair.publicKey, 'hex'),
    globalId: 'abc:123',
    globalParent: null,
    channel: 'general',
    topic: null,
    authorHandle: 'priya',
    authorName: 'Priya Sharma',
    body: 'signed across instances',
    ts: 1_700_000_000_000,
  };
}

describe('p2p frame signatures', () => {
  it('round-trips: signed frames verify', () => {
    expect(verifyFrame(signFrame(makeFrame(), pair.secretKey))).toBe(true);
  });

  it('rejects any tampering with signed fields', () => {
    const frame = signFrame(makeFrame(), pair.secretKey);
    expect(verifyFrame({ ...frame, body: 'wire me the payroll budget' })).toBe(false);
    expect(verifyFrame({ ...frame, authorHandle: 'sofia' })).toBe(false);
    expect(verifyFrame({ ...frame, channel: 'leadership' })).toBe(false);
  });

  it('rejects frames signed by a different key than claimed', () => {
    const other = hypercoreCrypto.keyPair();
    const forged = signFrame(makeFrame(), other.secretKey); // origin still claims `pair`
    expect(verifyFrame(forged)).toBe(false);
  });
});
