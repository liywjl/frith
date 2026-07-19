# Hardening backlog

Everything here traces back to one root fact of the architecture: **every peer
holds and serves the entire log.** Each item either bounds what a writer can
make honest peers hold, or narrows what a peer serves to others.

Items are ordered roughly by leverage. Check them off as they land.

## 1. Bound append rate per writer, at the reducer ✅

Today an admitted writer can append unlimited ops; honest peers must store and
replay all of it ([space.ts:102](apps/server/src/space/space.ts:102) makes
every joiner a permanent indexer). Add a per-writer, per-window op budget
enforced in the reducer; ops over budget are retained-but-inert and the writer
is flagged.

**Acceptance:** a writer emitting 10k ops/min does not grow other peers'
materialized state unboundedly.

**Done** — `FrithState.chargeWriter`
([state.ts](apps/server/src/space/state.ts)): each writer opens with
`WRITER_BURST` (4096) credits, spends 1 per op, and earns
`CREDITS_PER_OTHER_OP` (64) per interleaved op from *other* writers, capped at
the burst. Log position is the clock — wall clocks would diverge on a
from-scratch rebuild — so every peer reaches identical verdicts. Over-budget
ops stay in the log but never materialize, and the writer lands in
`state.flaggedWriters` (surface it in the UI as part of §5). A lone spammer
is hard-capped at the burst; colluding admitted writers can feed each other
credit, which is a membership problem — see §2. Tests in
[hardening.test.ts](apps/server/test/hardening.test.ts) ("per-writer append
budget").

## 2. Writer removal via membership epochs (log rotation)

`evictUser` ([space.ts:675](apps/server/src/space/space.ts:675)) revokes
bindings and rotates keys but never removes the writer core. Design a "found a
fresh Autobase excluding the writer, migrate honest members, abandon the old
log" flow.

**Acceptance:** after rotation, an evicted node's appends reach no honest
member's active log.

## 3. Selective replication by decryptable domain

Don't serve a peer the cores/blocks for domains it can't decrypt — closes the
metadata leak (non-members currently receive private-channel ciphertext and
envelopes). ROADMAP already flags this as "per-core serve control."

**Acceptance:** a non-member's node never stores blocks for a private channel
it isn't in.

## 4. Blob purge on eviction ✅

ROADMAP §7 item 1 — evicted identities' cached blob bytes get dropped from
honest peers' disks, not just locked going forward.

**Acceptance:** after eviction, honest peers' blob stores contain none of the
evicted-only content.

**Done** — when an *applied* (signature-valid, authorized) evict op drains,
`purgeEvictedBlobs` drops the local cache blocks of every attachment the
evicted user authored ([space.ts](apps/server/src/space/space.ts)). It runs
on every peer that applies the op — the purge is local, so each honest
member clears its own disk regardless of which peer performed the eviction;
the evicted node keeping its own bytes is out of scope. The evicted-set
guard means a forged evict op cannot grief-purge caches. Wiring tested in
[evict.test.ts](apps/server/test/evict.test.ts); byte-removal mechanics in
blobs.test.ts.

## 5. Decide + surface the authorship-verification policy ✅

`verified` is computed ([state.ts](apps/server/src/space/state.ts)) —
confirm the client actually renders the unverified/unknown states distinctly,
and decide whether any op types should upgrade from flag to reject.

**Acceptance:** a message from an unbound/mismatched writer is visibly
distinct in the UI.

**Done — policy: flag, don't reject.** History must converge on every peer,
so bad authorship marks a message rather than dropping it (rejection would
also let anyone censor by forging). The DTO sets `unverified` only on a
*provable* mismatch (`verified === false`) and only in production — dev's
one-writer-many-users setup makes authorship unknowable there, not
suspicious, and `undefined` (legacy pre-envelope ops) is never treated as an
accusation. The web client renders an "unverified" badge on flagged
messages ([Message.tsx](apps/web/src/components/Message.tsx)). Tests cover
all three states in prod ([prod.test.ts](apps/server/test/prod.test.ts)) and
the dev suppression ([hardening.test.ts](apps/server/test/hardening.test.ts)).
Follow-up idea: surface §1's `flaggedWriters` through the same badge
treatment.

## 6. Fingerprint-verification UX

ROADMAP §7 item 2 — short-code compare so two members can confirm each
other's identity out of band.

**Acceptance:** two users can compare codes and mark a contact verified.

## 7. Directory curator signatures

DESIGN §15 — entries in a directory feed should be signature-verified against
a curator key you trust, so a compromised host can't inject invite keys.

**Acceptance:** an unsigned/mis-signed entry is rejected by the client.

## 8. Production request-boundary regression tests ✅

The loopback origin/Host guards are in place
([hardening.test.ts](apps/server/test/hardening.test.ts)); add explicit
production-mode coverage that privileged routes reject unauthenticated callers
and that `FRITH_TRUSTED_ORIGIN` admits exactly one origin.

**Acceptance:** prod-mode tests green.

**Done** — [prod.test.ts](apps/server/test/prod.test.ts) runs the app with
`FRITH_MODE=production` and covers: everything 401s before the device is
bound, requests act as the bound user with cookies ignored, the dev surface
is never registered (404), and `FRITH_TRUSTED_ORIGIN` admits exactly the
configured origin — sibling subdomains, suffix spoofs, and port variants all
403, for both the Origin and Host gates. Note for operators: the env var is
read at process start, not per request.

## 9. Dependency pinning + review on the P2P stack ◐

Lockfiles pinned, and a documented review pass on the Pears/crypto
dependencies.

**Acceptance:** lockfile committed, no floating ranges on crypto-relevant
deps.

**Pinning done** — `autobase`, `b4a`, `blind-pairing`, `corestore`,
`hyperblobs`, `hypercore-crypto`, `hyperswarm`, `@noble/ciphers`, and
`@noble/hashes` are exact-pinned (no `^`) in every app's package.json;
`pnpm-lock.yaml` is committed. `pnpm audit --prod` is clean of high-severity
advisories: `adm-zip` (via onnxruntime-node) and `postcss` (via expo) are
force-patched through root `pnpm.overrides`; one moderate remains —
`uuid` <11.1.1 inside expo's xcode build tooling, accepted because it is
build-time only and forcing a v3→v11 major on that toolchain risks breaking
mobile builds. **Still open:** the documented human review pass over the
Pears stack — supply-chain trust in Holepunch's packages is currently
assumed, not audited.
