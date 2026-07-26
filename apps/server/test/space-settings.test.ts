// Space identity — name, description, logo — is manager-editable, enforced in
// the reducer (the boundary every peer applies identically). These tests drive
// FrithState directly with synthetic writers so we can act as owner, admin, or
// a plain member at will, and confirm forged/unauthorized ops are discarded.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import b4a from 'b4a';
import hypercoreCrypto from 'hypercore-crypto';
import {
  FrithState,
  deviceBindingMessage,
  roleMessage,
  settingMessage,
  logoMessage,
  type BlobId,
  type SpaceLogo,
} from '../src/space/state.js';

/** One participant: a root identity plus a bound device (its writer key). */
function member() {
  const seed = crypto.randomBytes(32);
  const pair = hypercoreCrypto.keyPair(seed);
  return {
    userId: crypto.randomUUID(),
    rootKey: b4a.toString(pair.publicKey, 'hex'),
    deviceKey: crypto.randomBytes(32).toString('hex'),
    sign: (msg: string) => b4a.toString(hypercoreCrypto.sign(b4a.from(msg), pair.secretKey), 'hex'),
  };
}

type Member = ReturnType<typeof member>;

/** Bind a member into the state: publish its root and a signed device op. */
function bind(state: FrithState, m: Member) {
  state.apply({ t: 'identity', userId: m.userId, rootKey: m.rootKey });
  state.apply({ t: 'device', userId: m.userId, deviceKey: m.deviceKey, sig: m.sign(deviceBindingMessage(m.userId, m.deviceKey)) });
}

/** A fully wired space: owner (first identity), an admin, and a plain member. */
function makeSpace() {
  const state = new FrithState();
  const owner = member();
  const admin = member();
  const plain = member();
  bind(state, owner); // first identity → owner
  bind(state, admin);
  bind(state, plain);
  // Owner grants admin.
  state.apply(
    {
      t: 'role',
      userId: admin.userId,
      role: 'admin',
      on: true,
      actorId: owner.userId,
      sig: owner.sign(roleMessage(admin.userId, 'admin', true)),
    },
    owner.deviceKey,
  );
  return { state, owner, admin, plain };
}

const rename = (m: Member, name: string) =>
  ({ t: 'setting' as const, key: 'name' as const, value: name, actorId: m.userId, sig: m.sign(settingMessage('name', name)) });
const describeOp = (m: Member, value: string) =>
  ({ t: 'setting' as const, key: 'description' as const, value, actorId: m.userId, sig: m.sign(settingMessage('description', value)) });

describe('space settings — name & description', () => {
  it('lets the owner rename the space', () => {
    const { state, owner } = makeSpace();
    state.apply(rename(owner, 'Acme HQ'), owner.deviceKey);
    expect(state.spaceName).toBe('Acme HQ');
  });

  it('lets an admin rename the space', () => {
    const { state, admin } = makeSpace();
    state.apply(rename(admin, 'Renamed by admin'), admin.deviceKey);
    expect(state.spaceName).toBe('Renamed by admin');
  });

  it('ignores a rename from a non-manager member', () => {
    const { state, owner, plain } = makeSpace();
    state.apply(rename(owner, 'Legit'), owner.deviceKey);
    state.apply(rename(plain, 'Hijacked'), plain.deviceKey);
    expect(state.spaceName).toBe('Legit');
  });

  it('ignores a rename to an empty name, and a forged signature', () => {
    const { state, owner } = makeSpace();
    state.apply(rename(owner, 'Kept'), owner.deviceKey);
    state.apply(rename(owner, ''), owner.deviceKey); // empty rejected
    state.apply({ t: 'setting', key: 'name', value: 'Forged', actorId: owner.userId, sig: 'deadbeef' }, owner.deviceKey);
    expect(state.spaceName).toBe('Kept');
  });

  it('ignores an op that claims the owner as actor but is signed by someone else', () => {
    const { state, owner, plain } = makeSpace();
    state.apply(rename(owner, 'Legit'), owner.deviceKey);
    // A member borrows the owner's actorId — their signature can't back it.
    state.apply(
      { t: 'setting', key: 'name', value: 'Impersonated', actorId: owner.userId, sig: plain.sign(settingMessage('name', 'Impersonated')) },
      plain.deviceKey,
    );
    expect(state.spaceName).toBe('Legit');
  });

  it('sets and clears the description (empty → null)', () => {
    const { state, admin } = makeSpace();
    state.apply(describeOp(admin, 'Where Acme plans launches'), admin.deviceKey);
    expect(state.spaceDescription).toBe('Where Acme plans launches');
    state.apply(describeOp(admin, ''), admin.deviceKey);
    expect(state.spaceDescription).toBeNull();
  });
});

describe('space settings — logo', () => {
  const id: BlobId = { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 42 };
  const logo = (m: Member, override?: Partial<SpaceLogo>): SpaceLogo => ({
    key: crypto.randomBytes(32).toString('hex'),
    id,
    hash: crypto.randomBytes(32).toString('hex'),
    mime: 'image/png',
    ...override,
  });

  it('lets a manager set and clear the logo', () => {
    const { state, owner } = makeSpace();
    const l = logo(owner);
    state.apply({ t: 'logo', logo: l, actorId: owner.userId, sig: owner.sign(logoMessage(l)) }, owner.deviceKey);
    expect(state.spaceLogo).toEqual(l);
    state.apply({ t: 'logo', logo: null, actorId: owner.userId, sig: owner.sign(logoMessage(null)) }, owner.deviceKey);
    expect(state.spaceLogo).toBeNull();
  });

  it('ignores a logo op from a non-manager and one with a mismatched signature', () => {
    const { state, owner, plain } = makeSpace();
    const l = logo(plain);
    state.apply({ t: 'logo', logo: l, actorId: plain.userId, sig: plain.sign(logoMessage(l)) }, plain.deviceKey);
    expect(state.spaceLogo).toBeNull();
    // Owner signs a *different* record than the op carries → verification fails.
    const l2 = logo(owner);
    state.apply({ t: 'logo', logo: l2, actorId: owner.userId, sig: owner.sign(logoMessage(logo(owner))) }, owner.deviceKey);
    expect(state.spaceLogo).toBeNull();
  });

  it('rejects a logo op whose mime or bytes were swapped after signing', () => {
    // The signature covers the whole record, not just the hash: `mime` picks
    // the content-type the public logo route serves, `key`/`id` pick the bytes.
    const { state, owner } = makeSpace();
    const l = logo(owner);
    const sig = owner.sign(logoMessage(l));
    state.apply({ t: 'logo', logo: { ...l, mime: 'image/svg+xml' }, actorId: owner.userId, sig }, owner.deviceKey);
    expect(state.spaceLogo).toBeNull();
    state.apply(
      { t: 'logo', logo: { ...l, key: crypto.randomBytes(32).toString('hex') }, actorId: owner.userId, sig },
      owner.deviceKey,
    );
    expect(state.spaceLogo).toBeNull();

    // And a scriptable type never lands, even correctly signed for it.
    const svg = logo(owner, { mime: 'image/svg+xml' });
    state.apply({ t: 'logo', logo: svg, actorId: owner.userId, sig: owner.sign(logoMessage(svg)) }, owner.deviceKey);
    expect(state.spaceLogo).toBeNull();
  });
});
