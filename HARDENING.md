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

## 2. Writer removal via membership epochs (log rotation) 📐

`evictUser` ([space.ts](apps/server/src/space/space.ts)) revokes bindings and
rotates keys but never removes the writer core. Design a "found a fresh
Autobase excluding the writer, migrate honest members, abandon the old log"
flow.

**Acceptance:** after rotation, an evicted node's appends reach no honest
member's active log.

**Status: designed, not yet implemented.** Until it lands, an evicted node's
appends still replicate into honest members' logs. They are inert — §10 drops
every content op from a revoked writer, and from any writer it went on to
admit, so nothing they append changes an honest peer's state — but they still
consume disk and replay time, which is what rotation fixes.

(This paragraph used to claim inertness before §10 existed. It was true only of
the signature-authorized op types: an evicted, device-revoked writer could
still rewrite profiles, create channels, post messages, and forge reactions and
blocks. Fixed in §10; the regression is pinned in
[authorization.test.ts](apps/server/test/authorization.test.ts).)

Design:

1. **Trigger.** A manager runs `rotateLog(actorId)` — offered in the UI after
   any eviction, and advisable after key compromise.
2. **Found.** The initiating device creates a fresh Autobase (new bootstrap
   key) in the same corestore, whose genesis op embeds
   `{ prevSpace, epochSeq, sig }` — the manager's root signature binds the new
   log to the old one so members can verify lineage.
3. **Announce.** The manager appends `{ t: 'space-rotated', next, epochSeq,
   actorId, sig }` to the OLD log. The signature covers `next`, so a
   compromised peer can't redirect members to a hijacked log. Highest
   authorized `epochSeq` wins, same convergence discipline as invite rotation.
4. **Migrate.** On applying a valid `space-rotated`, each honest device joins
   the new base: the rotating manager runs the blind-pairing admitting loop
   on the new log and re-admits only devices that are bound + unrevoked +
   unevicted at rotation time (it has their enc keys from the wraps, so
   admission can be automatic — no QR ceremony). State carries over as a
   manager-appended compacted snapshot of live rows, each op stamped
   `{ from: prevSpace }`; full history stays locally readable from the old
   log archive.
5. **Abandon.** After a grace window for offline devices (they catch up via
   the old log's `space-rotated` op whenever they reconnect), honest peers
   stop announcing/replicating the old discovery key and keep it read-only
   on disk per retention policy.

Evicted devices see the rotation op but hold no wraps for the new log's
invite and are not in the re-admission set — their appends land only on the
abandoned log. Test plan: two-peer harness, evict + rotate, assert the
evicted writer's post-rotation appends never reach an honest peer's active
view.

## 3. Selective replication by decryptable domain 📐

Don't serve a peer the cores/blocks for domains it can't decrypt — closes the
metadata leak (non-members currently receive private-channel ciphertext and
envelopes). ROADMAP already flags this as "per-core serve control."

**Acceptance:** a non-member's node never stores blocks for a private channel
it isn't in.

**Status: designed, not yet implemented.** Today non-members replicate
private-channel ciphertext plus envelope metadata (author, channel, timing).
Content is sealed (safe), but the traffic-analysis surface is real. The
constraint: all ops share ONE Autobase view, so private payloads can't be
withheld from the shared log — they have to move out of it. Design:

1. **Split payload from header.** New op type `msg2`: the shared log keeps
   the header (channel, author, keyId, `payloadRef`) while the body's
   ciphertext lives in a per-domain payload core (one per private channel,
   same pattern as blob cores). Public/space-domain messages keep inline
   bodies — no overhead where there's nothing to hide.
2. **Serve control.** Gate each payload core at the corestore replication
   session: a peer must prove domain membership before the core is served —
   its device key appears in a current epoch's wraps for that domain (the
   log both sides already hold makes this checkable without extra
   round-trips). Deny = don't announce the core on that session.
3. **Migration.** Old `msg` ops remain readable forever; clients write
   `msg2` for private channels once the payload core exists. No data
   migration required.
4. **Residual leak, stated honestly.** Headers still replicate to all
   members of the space (who posted in which private channel, when) — closing
   that fully means per-domain Autobases, a much larger change. This step
   closes the payload-bytes and size-correlation leak and stops non-members
   storing private blocks at all.

Test plan: two corestore peers, one non-member — assert zero payload-core
blocks transfer; then grant membership and assert they do.

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

**Done — policy: flag, don't reject** *(for message bodies; §10 rejects
outright where the op decides authorization rather than display)*. History must
converge on every peer,
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

**Scope, after §10:** the badge now covers only the genuinely unknowable case —
a message whose author no device is bound to. An op claiming an author who HAS
a bound device, from a device that isn't theirs, no longer applies at all.

## 6. Fingerprint-verification UX ✅

ROADMAP §7 item 2 — short-code compare so two members can confirm each
other's identity out of band.

**Acceptance:** two users can compare codes and mark a contact verified.

**Done** — a 40-digit safety code (8 spoken-size groups) derived
order-independently from both users' root keys
([contacts.ts](apps/server/src/domain/contacts.ts)), shown in the profile
panel with a "Mark as verified" toggle
([SafetyCode.tsx](apps/web/src/components/SafetyCode.tsx)). The mark is
device-local — your judgment, never log data — and it stores the code it
vouched for, so a contact whose root key changes silently drops back to
unverified. Hidden for identities without roots (dev-seeded demo users).
Tested in [evict.test.ts](apps/server/test/evict.test.ts).

## 7. Directory curator signatures ✅

DESIGN §15 — entries in a directory feed should be signature-verified against
a curator key you trust, so a compromised host can't inject invite keys.

**Acceptance:** an unsigned/mis-signed entry is rejected by the client.

**Done** — set `FRITH_DIRECTORY_CURATOR_KEY` to a curator's ed25519 public
key and only entries that key signed are served; unsigned, mis-signed, and
tampered-after-signing entries are rejected outright (a bogus invite is the
whole attack, so it never reaches the user). Each signature covers a hash of
every displayed field in fixed order
([directory.ts](apps/server/src/domain/directory.ts)). Curators sign feeds
with [sign-directory.ts](apps/server/scripts/sign-directory.ts); interop is
verified end to end. With no curator key configured the feed stays
display-only external data, as before. Tests in
[hardening.test.ts](apps/server/test/hardening.test.ts).

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

## 10. Authorize content ops at the reducer ✅

The reducer gated `identity`, `device`, `role`, `evict`, `setting`, `logo`,
`epoch`, `grant` and `invite-rotate` on root signatures and applied every other
op unconditionally. Since every peer replays every op, one admitted writer
could forge state on all honest peers: append
`{t:'member', channelId:<private>, userId:<self>}` and honest peers' `reconcile`
seals that channel's content keys — the whole keychain, under the default
`historyVisibility: 'full'` — to the forger's device. Also profile
impersonation (`user`), destruction (`unmember`, the sticky `doc-remove`), and
forged reactions, blocks, reads, pins and scheduled sends.

**Acceptance:** an admitted writer cannot change state in another member's
name, and an evicted one cannot change state at all.

**Done** — `FrithState.permits` ([state.ts](apps/server/src/space/state.ts)).
Content ops carry no signature, so they are authorized by *who appended them*:
the writer key in the op envelope, resolved through verified device bindings.
The verdict comes from the log alone, so every peer reaches it identically on a
from-scratch replay. Three layers:

1. **Inert writers.** A revoked device (theft, eviction) authors nothing — and
   neither does any writer it went on to admit, because autobase admits whoever
   an `add-writer` op names and an evicted node would otherwise just mint
   itself a clean key. This is what makes eviction bite before §2 lands.
2. **Claimable subjects.** The identity an op acts as or upon is protected once
   some device is bound to it. Identities with no device — dev's seeded cast,
   pre-identity spaces — are nobody's to impersonate, which is the same
   "authorship is unknowable here" case §5 settled, and is what keeps dev's
   one-writer-many-users setup working.
3. **Per-op rules.** `authorId === actor` for `msg`/`att`/`react`/`read`/
   `block`/`pin`/`pins`/`sched`/`unsched` and doc bylines; member, founder or
   manager for `member`/`unmember`/`archive`; creator or manager for
   `doc-remove`; managers only to freeze a public channel.

`deviceOwners` became device → *set* of users along the way: a machine holding
several root seeds (a shared dev box, or your laptop after importing a second
identity) legitimately speaks for each, and the old one-user map would have
called honest ops forgeries. Eviction unbinds the evicted user from every
device and revokes outright only the ones that were theirs alone.

§5's "flag, don't reject" still governs message *bodies*. It is the wrong
policy for membership, because key eligibility follows membership
automatically — there, an applied forgery is the breach. Legacy pre-envelope
ops (no writer) are grandfathered.

Two unsigned ops that reached signed surfaces are closed with it: `space` is
now founding-only (renames are manager-signed `setting` ops), and `att` is
first-write-wins so nobody swaps the bytes under a file someone already shared.

Tests: [authorization.test.ts](apps/server/test/authorization.test.ts) — each
case was a live forgery before this landed.

## 11. Bound what the log can make a peer fetch and hold ✅

Three ways an op could spend an honest peer's resources past what §1 bounds.

**Acceptance:** a claimed size cannot make a peer read more than its policy
allows, and op count is not the only budget.

**Done:**

- **Blob reads are capped.** `autoFetchAttachments` gated on `a.size` — the
  poster's claim in the `att` op — while `blobs.get` read the whole blob into
  one Buffer and only *then* checked `expectedHash`. A member could post an
  attachment claiming 1 KB whose bytes are 5 GB and have every default-policy
  peer pull it into memory. `BlobStore.get` now takes `maxBytes` and validates
  the locator before reading: `byteLength` against the cap, and the block range
  too, since tiny blocks would otherwise hide a huge fetch behind a small
  `byteLength`. Auto-fetch passes the policy, explicit downloads pass this
  device's own upload ceiling. Malformed core keys are refused rather than
  handed to corestore. (The core key in an `att` op is still attacker-chosen —
  the cap bounds what that costs; §3's serve control is the fuller answer.)
- **A per-writer byte budget** sits beside §1's op budget:
  `WRITER_BYTE_BURST` (32 MiB) with `BYTES_PER_OTHER_OP` (256 KiB) accruing on
  the same log-position clock. The HTTP edge caps bodies (10 KB messages,
  200 KB docs); a peer appending straight to the log never passes through it,
  so 4096 ops of any size was not a bound.
- **The logo signature covers the whole record**, not just the bytes' hash:
  `mime` decides the content-type the public `/api/space/logo` route serves and
  `key`/`id` decide which bytes it serves at all, so a replayed op with those
  swapped used to verify. The reducer also refuses a logo mime outside
  png/jpeg/gif/webp.

Tests in [blobs.test.ts](apps/server/test/blobs.test.ts),
[hardening.test.ts](apps/server/test/hardening.test.ts) and
[space-settings.test.ts](apps/server/test/space-settings.test.ts).

## 12. Edge hardening: framing, file serving, binding routes ✅

**Acceptance:** the local client can't be framed, a served file is what its
bytes are, and a local process can't re-point the device's identity.

**Done:**

- **CSP + `X-Frame-Options: DENY` on every response.** The loopback guard stops
  a foreign page *calling* the local server; nothing stopped one *framing*
  `http://127.0.0.1:<port>`, and a framed document's own `/api` calls carry a
  localhost Origin and pass the guard — so privileged UI (reveal invite, evict,
  post) was clickjackable in `dev:web` and any static deploy. Packaged Electron
  was never exposed; this is for everything else.
- **Serve-time mime sniffing.** `/api/files/:id` trusted `attachment.mime` from
  the log. Upload-time `effectiveMime` rejects `image/svg+xml`, but a
  peer-appended `att` op naming that mime with a `.png` name was served
  `inline` — a scriptable document on the app's origin. Bytes are re-sniffed at
  serve time and the demoted type drives both the content-type and the
  disposition. `Content-Disposition` also uses RFC 5987 `filename*` now: a
  CR/LF or non-latin1 name used to make Node throw on the header (500 instead
  of a download).
- **Binding routes leave the pre-login surface once the device is bound.**
  `POST /api/profiles` calls `bindLocalDevice`, which sets `boundUserId` — and
  in production `uid = space.boundUserId()`, so any local process could
  silently change who the running app acts as. In production a second profile
  now 409s, importing an identity with no root on the log 409s (there is
  nothing to prove possession against), and `space/join` + `spaces/switch`
  require a caller. Dev is unchanged: `uid` comes from the cookie there, so
  binding does not decide who a request is, and the profile picker has to be
  able to create profiles with no cookie in hand.
- **Mobile matched to desktop.** The worklet archived channels on
  `requireAccess` alone while the HTTP edge restricted public-channel archiving
  to managers — one op, two policies. Now one.
- **Scheduled sends are author-scoped.** `claimDueScheduled` returned every
  member's due rows and every peer runs the timer, so a device posted messages
  attributed to other people and two online peers double-delivered. Only the
  author's own device sends for them (an identity with no device of its own —
  dev's cast — still gets delivered here, since nobody else will). The same
  scoping applies to the expired-status sweep.
- **Smaller things:** `verified-contacts.json` and `policies.json` are written
  0600 like the registry; profile links must match `https?://` (`startsWith('http')`
  also admitted `httpx://`); and the desktop keychain fallback — on a Linux
  desktop with no secret service the master key lands in a 0600 file instead of
  the OS keychain — is surfaced in the Storage panel rather than only warned to
  the console, since it changes the at-rest story.

**Residual, stated honestly:** on the loopback boundary, any process running as
the OS user can still act as the bound identity — that is inherent to
"127.0.0.1 plus the OS user is the trust boundary" (DESIGN §17), and what
changed is that it can no longer *persistently re-point* that identity.
