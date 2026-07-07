// Cryptographic member revocation: the reducer's authorization rules and the
// content-key layer that makes eviction real. These are pure/deterministic —
// no networking — so they nail the security properties directly.
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import {
  FrithState,
  deviceBindingMessage,
  evictMessage,
  epochMessage,
  inviteRotateMessage,
  roleMessage,
  channelDomain,
  type Domain,
  type Op,
} from '../src/space/state.js';
import {
  deviceEncKeyPair,
  keyIdOf,
  newContentKey,
  sealKey,
  openKey,
  sealContent,
  openContent,
  envelopeKeyId,
  isEnvelope,
  wrapsHash,
  type EncKeyPair,
} from '../src/space/crypto.js';

/** A test actor: a root identity plus one device (writer + enc keypair). */
interface Actor {
  userId: string;
  seedHex: string;
  rootKey: string;
  deviceKey: string;
  enc: EncKeyPair;
  sign(message: string): string;
}

function mkActor(userId: string): Actor {
  const seed = crypto.randomBytes(32);
  const pair = hypercoreCrypto.keyPair(seed);
  return {
    userId,
    seedHex: b4a.toString(seed, 'hex'),
    rootKey: b4a.toString(pair.publicKey, 'hex'),
    deviceKey: crypto.randomBytes(32).toString('hex'),
    enc: deviceEncKeyPair(),
    sign: (message) => b4a.toString(hypercoreCrypto.sign(b4a.from(message), pair.secretKey), 'hex'),
  };
}

/** Publish an actor's identity + root-vouched device binding into state. */
function admit(state: FrithState, a: Actor): void {
  state.apply({ t: 'identity', userId: a.userId, rootKey: a.rootKey });
  state.apply({
    t: 'device',
    userId: a.userId,
    deviceKey: a.deviceKey,
    encPubKey: a.enc.publicKey,
    sig: a.sign(deviceBindingMessage(a.userId, a.deviceKey, a.enc.publicKey)),
  });
}

/** Build a signed epoch op that seals `keyHex` to the given devices. */
function epochOp(by: Actor, domain: Domain, keyHex: string, seq: number, devices: Actor[]): Op {
  const keyId = keyIdOf(keyHex);
  const wraps: Record<string, string> = {};
  for (const d of devices) wraps[d.deviceKey] = sealKey(keyHex, d.enc.publicKey);
  return {
    t: 'epoch',
    domain,
    keyId,
    seq,
    wraps,
    actorId: by.userId,
    sig: by.sign(epochMessage(domain, keyId, seq, wrapsHash(wraps))),
  };
}

describe('content-key crypto', () => {
  it('seals a key to a device and only that device opens it', () => {
    const key = newContentKey();
    const alice = deviceEncKeyPair();
    const mallory = deviceEncKeyPair();
    const sealed = sealKey(key, alice.publicKey);
    expect(openKey(sealed, keyIdOf(key), alice)).toBe(key);
    expect(openKey(sealed, keyIdOf(key), mallory)).toBeNull();
  });

  it('rejects a wrap whose contents do not hash to the advertised keyId', () => {
    const real = newContentKey();
    const fake = newContentKey();
    const alice = deviceEncKeyPair();
    // A malicious grant seals `fake` but claims it is `real`'s keyId.
    const forged = sealKey(fake, alice.publicKey);
    expect(openKey(forged, keyIdOf(real), alice)).toBeNull();
  });

  it('round-trips a content envelope and tags it with the keyId', () => {
    const key = newContentKey();
    const env = sealContent(key, 'hello world');
    expect(isEnvelope(env)).toBe(true);
    expect(envelopeKeyId(env)).toBe(keyIdOf(key));
    expect(openContent(key, env)).toBe('hello world');
  });
});

describe('reducer: roles and authorization', () => {
  it('makes the first identity the owner', () => {
    const state = new FrithState();
    const owner = mkActor('owner');
    const other = mkActor('other');
    admit(state, owner);
    admit(state, other);
    expect(state.ownerUserId).toBe('owner');
    expect(state.canManage('owner')).toBe(true);
    expect(state.canManage('other')).toBe(false);
  });

  it('lets only the owner grant admin', () => {
    const state = new FrithState();
    const owner = mkActor('owner');
    const bea = mkActor('bea');
    const cy = mkActor('cy');
    [owner, bea, cy].forEach((a) => admit(state, a));

    // A non-owner trying to appoint an admin is ignored.
    state.apply({ t: 'role', userId: cy.userId, role: 'admin', on: true, actorId: bea.userId, sig: bea.sign(roleMessage(cy.userId, 'admin', true)) }, bea.deviceKey);
    expect(state.admins.has(cy.userId)).toBe(false);

    // Claiming to be the owner without the owner's signature is ignored too.
    state.apply({ t: 'role', userId: cy.userId, role: 'admin', on: true, actorId: owner.userId, sig: bea.sign(roleMessage(cy.userId, 'admin', true)) }, bea.deviceKey);
    expect(state.admins.has(cy.userId)).toBe(false);

    // The owner can.
    state.apply({ t: 'role', userId: bea.userId, role: 'admin', on: true, actorId: owner.userId, sig: owner.sign(roleMessage(bea.userId, 'admin', true)) }, owner.deviceKey);
    expect(state.admins.has(bea.userId)).toBe(true);
    expect(state.canManage('bea')).toBe(true);
  });

  it('ignores an evict from a non-manager and a forged signature', () => {
    const state = new FrithState();
    const owner = mkActor('owner');
    const bea = mkActor('bea');
    const victim = mkActor('victim');
    [owner, bea, victim].forEach((a) => admit(state, a));

    // Non-manager bea tries to evict the victim → ignored.
    state.apply({ t: 'evict', userId: victim.userId, actorId: bea.userId, sig: bea.sign(evictMessage(victim.userId)) }, bea.deviceKey);
    expect(state.evicted.has(victim.userId)).toBe(false);

    // Claiming to be the owner without the owner's signature → ignored.
    state.apply({ t: 'evict', userId: victim.userId, actorId: owner.userId, sig: bea.sign(evictMessage(victim.userId)) }, bea.deviceKey);
    expect(state.evicted.has(victim.userId)).toBe(false);

    // The owner's root, but a signature over the wrong message → ignored.
    state.apply({ t: 'evict', userId: victim.userId, actorId: owner.userId, sig: owner.sign('frith:evict:someone-else') }, owner.deviceKey);
    expect(state.evicted.has(victim.userId)).toBe(false);

    // The owner can never be evicted, even by an admin.
    state.apply({ t: 'role', userId: bea.userId, role: 'admin', on: true, actorId: owner.userId, sig: owner.sign(roleMessage(bea.userId, 'admin', true)) }, owner.deviceKey);
    state.apply({ t: 'evict', userId: owner.userId, actorId: bea.userId, sig: bea.sign(evictMessage(owner.userId)) }, bea.deviceKey);
    expect(state.evicted.has(owner.userId)).toBe(false);
  });
});

describe('reducer: eviction rotates the content key', () => {
  it('locks an evicted member out of the next key while others keep reading', () => {
    const state = new FrithState();
    const owner = mkActor('owner');
    const bea = mkActor('bea'); // stays
    const evil = mkActor('evil'); // gets evicted
    [owner, bea, evil].forEach((a) => admit(state, a));

    // Epoch 1: sealed to everyone.
    const key1 = newContentKey();
    state.apply(epochOp(owner, 'space', key1, 0, [owner, bea, evil]), owner.deviceKey);
    expect(state.currentKeyId('space')).toBe(keyIdOf(key1));
    // The soon-to-be-evicted member can read epoch 1.
    const wrap1 = state.domains.get('space')!.get(keyIdOf(key1))!.wraps[evil.deviceKey]!;
    expect(openKey(wrap1, keyIdOf(key1), evil.enc)).toBe(key1);

    // Evict evil.
    state.apply({ t: 'evict', userId: evil.userId, actorId: owner.userId, sig: owner.sign(evictMessage(evil.userId)) }, owner.deviceKey);
    expect(state.evicted.has(evil.userId)).toBe(true);
    expect(state.revokedDevices.has(evil.deviceKey)).toBe(true);
    expect(state.deviceOwners.has(evil.deviceKey)).toBe(false);

    // Epoch 2: the manager seals only to the survivors (as space.ts does).
    const key2 = newContentKey();
    state.apply(epochOp(owner, 'space', key2, 1, [owner, bea]), owner.deviceKey);
    const chain = state.domains.get('space')!;
    expect(state.currentKeyId('space')).toBe(keyIdOf(key2)); // seq 1 > seq 0
    expect(chain.get(keyIdOf(key2))!.wraps[evil.deviceKey]).toBeUndefined();

    // A message under the new key: survivors read it, the evictee cannot.
    const secret = sealContent(key2, 'post-eviction plans');
    expect(openContent(key2, secret)).toBe('post-eviction plans');
    // The evictee holds key1 but not key2, and gets no wrap to recover it.
    expect(envelopeKeyId(secret)).toBe(keyIdOf(key2));
    expect(openKey(state.domains.get('space')!.get(keyIdOf(key1))!.wraps[evil.deviceKey]!, keyIdOf(key1), evil.enc)).toBe(key1);

    // A malicious insider re-granting the new key to the evictee is refused.
    state.apply({ t: 'grant', domain: 'space', keyId: keyIdOf(key2), deviceKey: evil.deviceKey, sealed: sealKey(key2, evil.enc.publicKey) }, bea.deviceKey);
    expect(chain.get(keyIdOf(key2))!.wraps[evil.deviceKey]).toBeUndefined();
  });
});

describe('reducer: channel domains', () => {
  const setupChannel = () => {
    const state = new FrithState();
    const owner = mkActor('owner');
    const member = mkActor('member');
    const outsider = mkActor('outsider');
    [owner, member, outsider].forEach((a) => admit(state, a));
    state.apply({
      t: 'channel',
      channel: { id: 'chan1', name: 'secret', type: 'private', topic: null, archivedAt: null },
    });
    state.apply({ t: 'member', channelId: 'chan1', userId: member.userId });
    return { state, owner, member, outsider, domain: channelDomain('chan1') };
  };

  it('lets a channel member (non-manager) rotate their own channel, but not outsiders', () => {
    const { state, member, outsider, domain } = setupChannel();
    const key = newContentKey();
    state.apply(epochOp(member, domain, key, 0, [member]), member.deviceKey);
    expect(state.currentKeyId(domain)).toBe(keyIdOf(key));

    // An outsider (not a member, not a manager) can't mint for this channel…
    const key2 = newContentKey();
    state.apply(epochOp(outsider, domain, key2, 1, [outsider]), outsider.deviceKey);
    expect(state.currentKeyId(domain)).toBe(keyIdOf(key));
    // …and can't rotate the space domain either.
    state.apply(epochOp(outsider, 'space', key2, 0, [outsider]), outsider.deviceKey);
    expect(state.currentKeyId('space')).toBeNull();
  });

  it('refuses grants that would hand a channel key to a non-member device', () => {
    const { state, member, outsider, domain } = setupChannel();
    const key = newContentKey();
    state.apply(epochOp(member, domain, key, 0, [member]), member.deviceKey);
    state.apply(
      { t: 'grant', domain, keyId: keyIdOf(key), deviceKey: outsider.deviceKey, sealed: sealKey(key, outsider.enc.publicKey) },
      member.deviceKey,
    );
    expect(state.hasWrap(domain, keyIdOf(key), outsider.deviceKey)).toBe(false);
  });

  it('rejects an epoch whose wraps were altered after signing', () => {
    const { state, owner, member, domain } = setupChannel();
    const key = newContentKey();
    const op = epochOp(owner, domain, key, 0, [owner, member]);
    // A malicious writer copies the op but strips a member's wrap.
    const mutated = { ...op, wraps: { [owner.deviceKey]: (op as { wraps: Record<string, string> }).wraps[owner.deviceKey]! } } as Op;
    state.apply(mutated, member.deviceKey);
    expect(state.currentKeyId(domain)).toBeNull(); // signature no longer covers the wraps
    state.apply(op, owner.deviceKey); // the genuine op still lands
    expect(state.currentKeyId(domain)).toBe(keyIdOf(key));
  });
});

describe('reducer: invite rotation', () => {
  const inviteOp = (by: Actor, seq: number, publicKey: string, devices: Actor[]): Op => {
    const wraps: Record<string, string> = {};
    for (const d of devices) wraps[d.deviceKey] = sealKey(newContentKey(), d.enc.publicKey); // payload irrelevant here
    return {
      t: 'invite-rotate',
      seq,
      publicKey,
      discoveryKey: `dk-${publicKey}`,
      wraps,
      actorId: by.userId,
      sig: by.sign(inviteRotateMessage(seq, publicKey, `dk-${publicKey}`, wrapsHash(wraps))),
    };
  };

  it('only managers rotate the invite, and peers converge on (seq, publicKey)', () => {
    const owner = mkActor('owner');
    const bea = mkActor('bea');

    const build = (order: 'ab' | 'ba') => {
      const state = new FrithState();
      admit(state, owner);
      admit(state, bea);
      // Non-manager rotation is ignored outright.
      state.apply(inviteOp(bea, 5, 'ff'.repeat(32), [bea]), bea.deviceKey);
      expect(state.currentInvite).toBeNull();
      const a = inviteOp(owner, 1, 'aa'.repeat(32), [owner, bea]);
      const b = inviteOp(owner, 1, 'bb'.repeat(32), [owner, bea]);
      for (const op of order === 'ab' ? [a, b] : [b, a]) state.apply(op, owner.deviceKey);
      return state.currentInvite!.publicKey;
    };
    expect(build('ab')).toBe('bb'.repeat(32)); // higher publicKey wins the tie
    expect(build('ba')).toBe('bb'.repeat(32)); // regardless of arrival order
  });
});

describe('reducer: determinism under concurrent rotation', () => {
  it('converges on the same current key regardless of op order', () => {
    const owner = mkActor('owner');
    const keyA = newContentKey();
    const keyB = newContentKey();

    // Two managers mint different keys at the SAME seq (a concurrent rotation).
    const build = (order: 'ab' | 'ba') => {
      const state = new FrithState();
      admit(state, owner);
      const ops = [epochOp(owner, 'space', keyA, 1, [owner]), epochOp(owner, 'space', keyB, 1, [owner])];
      const seq = order === 'ab' ? ops : [ops[1]!, ops[0]!];
      seq.forEach((op) => state.apply(op, owner.deviceKey));
      return state;
    };

    const chosen = build('ab').currentKeyId('space');
    expect(build('ba').currentKeyId('space')).toBe(chosen);
    // Tiebreak is the greater keyId hex, and BOTH keys are retained so every
    // message decrypts no matter which key it used.
    expect(chosen).toBe([keyIdOf(keyA), keyIdOf(keyB)].sort().at(-1));
    expect(build('ab').keyIds('space').sort()).toEqual([keyIdOf(keyA), keyIdOf(keyB)].sort());
  });

  it('keeps the higher-seq key current across a reordered replay', () => {
    const owner = mkActor('owner');
    const key0 = newContentKey();
    const key1 = newContentKey();
    const op0 = epochOp(owner, 'space', key0, 0, [owner]);
    const op1 = epochOp(owner, 'space', key1, 1, [owner]);

    const forward = new FrithState();
    admit(forward, owner);
    [op0, op1].forEach((o) => forward.apply(o, owner.deviceKey));

    const reordered = new FrithState();
    admit(reordered, owner);
    [op1, op0].forEach((o) => reordered.apply(o, owner.deviceKey));

    expect(forward.currentKeyId('space')).toBe(keyIdOf(key1));
    expect(reordered.currentKeyId('space')).toBe(keyIdOf(key1));
  });
});
