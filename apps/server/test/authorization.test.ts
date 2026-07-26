// Reducer authorization for content ops (HARDENING §10). Identity and
// membership-control ops carry root signatures; content ops don't, so they are
// authorized by WHO APPENDED them. Every peer replays every op, which is why
// these run against FrithState directly: what the reducer refuses to
// materialize, no honest peer's state grows by.
//
// Each case here was a live forgery before the guard landed.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import { FrithState, deviceBindingMessage, evictMessage, type Op } from '../src/space/state.js';
import { deviceEncKeyPair, type EncKeyPair } from '../src/space/crypto.js';

interface Actor {
  userId: string;
  rootKey: string;
  deviceKey: string;
  enc: EncKeyPair;
  sign(message: string): string;
}

function mkActor(): Actor {
  const pair = hypercoreCrypto.keyPair(crypto.randomBytes(32));
  return {
    userId: crypto.randomUUID(),
    rootKey: b4a.toString(pair.publicKey, 'hex'),
    deviceKey: crypto.randomBytes(32).toString('hex'),
    enc: deviceEncKeyPair(),
    sign: (message) => b4a.toString(hypercoreCrypto.sign(b4a.from(message), pair.secretKey), 'hex'),
  };
}

/** Profile row, root identity, root-vouched device binding — onboarding order. */
function admit(state: FrithState, a: Actor, by = a.deviceKey): void {
  state.apply({ t: 'user', id: a.userId, patch: { handle: a.userId.slice(0, 6), name: 'Someone' } }, by);
  state.apply({ t: 'identity', userId: a.userId, rootKey: a.rootKey }, by);
  state.apply(
    {
      t: 'device',
      userId: a.userId,
      deviceKey: a.deviceKey,
      encPubKey: a.enc.publicKey,
      sig: a.sign(deviceBindingMessage(a.userId, a.deviceKey, a.enc.publicKey)),
    },
    by,
  );
}

/** A space with an owner, a private channel they founded, and an outsider who
 *  is an admitted writer but not in that channel. */
function scenario() {
  const state = new FrithState();
  const owner = mkActor();
  const mallory = mkActor();
  admit(state, owner);
  admit(state, mallory);
  const channelId = crypto.randomUUID();
  state.apply(
    { t: 'channel', channel: { id: channelId, name: 'war-room', type: 'private', topic: null, archivedAt: null } },
    owner.deviceKey,
  );
  state.apply({ t: 'member', channelId, userId: owner.userId }, owner.deviceKey);
  return { state, owner, mallory, channelId };
}

describe('a member cannot write themselves into a private channel', () => {
  it('drops a forged member op — key eligibility follows membership, so this one op is the whole breach', () => {
    const { state, mallory, channelId } = scenario();
    state.apply({ t: 'member', channelId, userId: mallory.userId }, mallory.deviceKey);
    expect(state.members.get(channelId)?.has(mallory.userId)).toBe(false);
    // The consequence that mattered: honest peers seal content keys to any
    // device deviceInDomain() accepts, and reconcile hands over the whole
    // keychain under the default historyVisibility.
    expect(state.deviceInDomain(mallory.deviceKey, `channel:${channelId}`)).toBe(false);
  });

  it('still lets the channel’s own members add people, and lets anyone leave', () => {
    const { state, owner, mallory, channelId } = scenario();
    state.apply({ t: 'member', channelId, userId: mallory.userId }, owner.deviceKey);
    expect(state.members.get(channelId)?.has(mallory.userId)).toBe(true);
    expect(state.deviceInDomain(mallory.deviceKey, `channel:${channelId}`)).toBe(true);

    state.apply({ t: 'unmember', channelId, userId: mallory.userId }, mallory.deviceKey);
    expect(state.members.get(channelId)?.has(mallory.userId)).toBe(false);
  });

  it('drops a forged unmember op — emptying someone else’s channel is not a right', () => {
    const { state, owner, mallory, channelId } = scenario();
    state.apply({ t: 'unmember', channelId, userId: owner.userId }, mallory.deviceKey);
    expect(state.members.get(channelId)?.has(owner.userId)).toBe(true);
  });
});

describe('a member cannot speak as someone else', () => {
  it('drops a profile rewrite of another identity', () => {
    const { state, owner, mallory } = scenario();
    state.apply(
      { t: 'user', id: owner.userId, patch: { handle: 'olive', name: 'Not Olive', bio: 'call me at…' } },
      mallory.deviceKey,
    );
    expect(state.users.get(owner.userId)?.name).toBe('Someone');
  });

  it('drops a message, reaction, read marker and block attributed to another identity', () => {
    const { state, owner, mallory, channelId } = scenario();
    const message = {
      id: 'm1',
      channelId,
      authorId: owner.userId,
      parentMessageId: null,
      body: 'I approve this',
      createdAt: '2026-07-26T00:00:00Z',
    };
    state.apply({ t: 'msg', message }, mallory.deviceKey);
    expect(state.messages.has('m1')).toBe(false);

    state.apply({ t: 'react', messageId: 'm1', userId: owner.userId, emoji: '👍', on: true }, mallory.deviceKey);
    expect(state.reactions.get('m1')).toBeUndefined();

    state.apply({ t: 'read', userId: owner.userId, channelId, at: '2026-07-26T00:00:00Z' }, mallory.deviceKey);
    expect(state.reads.size).toBe(0);

    state.apply({ t: 'block', userId: owner.userId, blockedId: mallory.userId, on: true }, mallory.deviceKey);
    expect(state.blocks.get(owner.userId)).toBeUndefined();
  });

  it('lets each device write in its own name', () => {
    const { state, owner, mallory, channelId } = scenario();
    const message = {
      id: 'm2',
      channelId,
      authorId: owner.userId,
      parentMessageId: null,
      body: 'mine',
      createdAt: '2026-07-26T00:00:00Z',
    };
    state.apply({ t: 'msg', message }, owner.deviceKey);
    expect(state.messages.get('m2')?.verified).toBe(true);
    state.apply({ t: 'react', messageId: 'm2', userId: mallory.userId, emoji: '👍', on: true }, mallory.deviceKey);
    expect(state.reactions.get('m2')?.has(`${mallory.userId}:👍`)).toBe(true);
  });

  it('keeps speaking for every identity a device legitimately holds', () => {
    // One machine, several root seeds — a shared dev box, or your laptop after
    // importing a second identity. It speaks for all of them, and nobody else.
    const state = new FrithState();
    const first = mkActor();
    const second = mkActor();
    admit(state, first);
    admit(state, { ...second, deviceKey: first.deviceKey }, first.deviceKey);
    state.apply({ t: 'user', id: second.userId, patch: { handle: 'two', name: 'Second' } }, first.deviceKey);
    expect(state.users.get(second.userId)?.name).toBe('Second');
  });
});

describe('docs and scheduled messages', () => {
  it('drops a doc removal by someone who neither wrote it nor manages the space', () => {
    const { state, owner, mallory } = scenario();
    const doc = {
      id: 'd1',
      title: 'Plans',
      body: 'the plan',
      createdBy: owner.userId,
      updatedBy: owner.userId,
      updatedAt: '2026-07-26T00:00:00Z',
    };
    state.apply({ t: 'doc', doc }, owner.deviceKey);
    state.apply({ t: 'doc-remove', docId: 'd1' }, mallory.deviceKey);
    // Removal is sticky, so a successful forgery would be unrecoverable.
    expect(state.docs.has('d1')).toBe(true);
    expect(state.removedDocs.has('d1')).toBe(false);

    state.apply({ t: 'doc-remove', docId: 'd1' }, owner.deviceKey);
    expect(state.docs.has('d1')).toBe(false);
  });

  it('drops a doc edit bylined as someone else', () => {
    const { state, owner, mallory } = scenario();
    const doc = {
      id: 'd2',
      title: 'Plans',
      body: 'original',
      createdBy: owner.userId,
      updatedBy: owner.userId,
      updatedAt: '2026-07-26T00:00:00Z',
    };
    state.apply({ t: 'doc', doc }, owner.deviceKey);
    state.apply({ t: 'doc', doc: { ...doc, body: 'rewritten', updatedAt: '2026-07-27T00:00:00Z' } }, mallory.deviceKey);
    expect(state.docs.get('d2')?.body).toBe('original');
  });

  it('drops a scheduled send queued in another name, and its cancellation', () => {
    const { state, owner, mallory, channelId } = scenario();
    const scheduled = {
      id: 's1',
      channelId,
      authorId: owner.userId,
      parentMessageId: null,
      body: 'I quit',
      sendAt: '2026-07-27T00:00:00Z',
    };
    state.apply({ t: 'sched', scheduled }, mallory.deviceKey);
    expect(state.scheduled.has('s1')).toBe(false);

    state.apply({ t: 'sched', scheduled }, owner.deviceKey);
    state.apply({ t: 'unsched', id: 's1' }, mallory.deviceKey);
    expect(state.scheduled.has('s1')).toBe(true);
  });
});

describe('attachments', () => {
  it('refuses to swap the bytes under a file someone already shared', () => {
    const { state, owner, channelId } = scenario();
    const blobId = { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 8 };
    const attachment = {
      id: 'a1',
      messageId: 'm3',
      name: 'notes.pdf',
      mime: 'application/pdf',
      size: 8,
      hash: 'aa'.repeat(32),
      blob: { key: 'bb'.repeat(32), id: blobId },
    };
    state.apply({ t: 'att', attachment }, owner.deviceKey);
    state.apply(
      {
        t: 'msg',
        message: {
          id: 'm3',
          channelId,
          authorId: owner.userId,
          parentMessageId: null,
          body: '',
          createdAt: '2026-07-26T00:00:00Z',
        },
      },
      owner.deviceKey,
    );
    state.apply({ t: 'att', attachment: { ...attachment, hash: 'cc'.repeat(32) } }, owner.deviceKey);
    expect(state.attachments.get('a1')?.hash).toBe('aa'.repeat(32));
    expect(state.attachmentsByMessage.get('m3')).toHaveLength(1);
  });
});

describe('an evicted node’s appends are inert (HARDENING §2)', () => {
  /** Evict `who`, signed by the owner — the real authorization path. */
  const evict = (state: FrithState, owner: Actor, who: Actor) =>
    state.apply(
      { t: 'evict', userId: who.userId, actorId: owner.userId, sig: owner.sign(evictMessage(who.userId)) },
      owner.deviceKey,
    );

  it('stops changing honest peers’ state the moment eviction applies', () => {
    const { state, owner, mallory, channelId } = scenario();
    evict(state, owner, mallory);
    expect(state.revokedDevices.has(mallory.deviceKey)).toBe(true);

    // Profiles, channels, messages, reactions — all inert, including ops in
    // their own name. Before §10 every one of these still landed.
    state.apply({ t: 'user', id: mallory.userId, patch: { handle: 'm', name: 'Back' } }, mallory.deviceKey);
    expect(state.users.get(mallory.userId)?.name).toBe('Someone');

    const newChannel = crypto.randomUUID();
    state.apply(
      { t: 'channel', channel: { id: newChannel, name: 'ghost', type: 'public', topic: null, archivedAt: null } },
      mallory.deviceKey,
    );
    expect(state.channels.has(newChannel)).toBe(false);

    state.apply(
      {
        t: 'msg',
        message: {
          id: 'm4',
          channelId,
          authorId: mallory.userId,
          parentMessageId: null,
          body: 'still here',
          createdAt: '2026-07-26T00:00:00Z',
        },
      },
      mallory.deviceKey,
    );
    expect(state.messages.has('m4')).toBe(false);
  });

  it('does not let them mint a fresh writer key and carry on', () => {
    // Autobase admits whoever an add-writer op names, so the reducer tracks
    // provenance: a writer admitted by an inert one is inert too.
    const { state, owner, mallory } = scenario();
    evict(state, owner, mallory);
    const secondKey = crypto.randomBytes(32).toString('hex');
    state.apply({ t: 'add-writer', key: secondKey }, mallory.deviceKey);
    expect(state.taintedWriters.has(secondKey)).toBe(true);

    const newChannel = crypto.randomUUID();
    state.apply(
      { t: 'channel', channel: { id: newChannel, name: 'ghost2', type: 'public', topic: null, archivedAt: null } },
      secondKey,
    );
    expect(state.channels.has(newChannel)).toBe(false);

    // Nor launder themselves back in behind a brand-new identity on that key:
    // binding is refused, so honest peers never seal content keys to it.
    const alias = mkActor();
    admit(state, { ...alias, deviceKey: secondKey }, secondKey);
    expect(state.deviceOwners.has(secondKey)).toBe(false);
    expect(state.deviceInDomain(secondKey, 'space')).toBe(false);
  });

  it('leaves a device shared with an unevicted identity working for that identity', () => {
    // Revoking the shared machine would evict a bystander along with the target.
    const state = new FrithState();
    const owner = mkActor();
    const guest = mkActor();
    admit(state, owner);
    admit(state, { ...guest, deviceKey: owner.deviceKey }, owner.deviceKey);
    state.apply(
      { t: 'evict', userId: guest.userId, actorId: owner.userId, sig: owner.sign(evictMessage(guest.userId)) },
      owner.deviceKey,
    );
    expect(state.revokedDevices.has(owner.deviceKey)).toBe(false);
    expect(state.deviceOwners.get(owner.deviceKey)?.has(guest.userId)).toBe(false);
    state.apply({ t: 'user', id: owner.userId, patch: { handle: 'o', name: 'Still Here' } }, owner.deviceKey);
    expect(state.users.get(owner.userId)?.name).toBe('Still Here');
  });
});

describe('unsigned ops cannot reach signed surfaces', () => {
  it('ignores a `space` op once the space is named — renames are manager-signed', () => {
    const { state, mallory } = scenario();
    state.apply({ t: 'space', name: 'Legit' }, mallory.deviceKey);
    expect(state.spaceName).toBe('Legit'); // founding write
    state.apply({ t: 'space', name: 'Hijacked' }, mallory.deviceKey);
    expect(state.spaceName).toBe('Legit');
  });

  it('only lets managers freeze a public channel', () => {
    const { state, owner, mallory } = scenario();
    const id = crypto.randomUUID();
    state.apply(
      { t: 'channel', channel: { id, name: 'town-square', type: 'public', topic: null, archivedAt: null } },
      owner.deviceKey,
    );
    state.apply({ t: 'archive', channelId: id, archived: true, at: '2026-07-26T00:00:00Z' }, mallory.deviceKey);
    expect(state.channels.get(id)?.archivedAt).toBeNull();
    state.apply({ t: 'archive', channelId: id, archived: true, at: '2026-07-26T00:00:00Z' }, owner.deviceKey);
    expect(state.channels.get(id)?.archivedAt).not.toBeNull();
  });
});

describe('the dev cast still works', () => {
  // One writer speaking for many seeded users is dev's whole setup (§5). Those
  // identities hold no root and no device, so there is nothing to impersonate.
  it('applies ops for identities no device is bound to', () => {
    const state = new FrithState();
    const dev = crypto.randomBytes(32).toString('hex');
    const seeded = crypto.randomUUID();
    const other = crypto.randomUUID();
    state.apply({ t: 'user', id: seeded, patch: { handle: 'alice', name: 'Alice' } }, dev);
    state.apply({ t: 'user', id: other, patch: { handle: 'bob', name: 'Bob' } }, dev);
    const channelId = crypto.randomUUID();
    state.apply(
      { t: 'channel', channel: { id: channelId, name: 'general', type: 'private', topic: null, archivedAt: null } },
      dev,
    );
    state.apply({ t: 'member', channelId, userId: seeded }, dev);
    state.apply({ t: 'member', channelId, userId: other }, dev);
    expect(state.members.get(channelId)?.size).toBe(2);
    expect(state.users.get(seeded)?.name).toBe('Alice');
  });

  it('grandfathers pre-envelope ops, which carry no writer at all', () => {
    const { state, owner } = scenario();
    const op: Op = { t: 'user', id: owner.userId, patch: { handle: 'legacy', name: 'Legacy Write' } };
    state.apply(op);
    expect(state.users.get(owner.userId)?.name).toBe('Legacy Write');
  });
});
