# Roadmap

The chat core (P2P spaces over Autobase/Hyperswarm) works today. This file
scopes what's next, in order. The landing page (`site/`) sells this sequence;
keep the two in sync.

## 1. Landing page & distribution — now

- `site/index.html` — static, self-contained, deployable to any static host
  (GitHub Pages / Cloudflare Pages). No backend; early-access CTA is mailto.
- Later: opt-in **community directory** — a curated list of public spaces
  (itself just a signed Autobase feed, no server needed).

## 2. Storage & sharing policies — shipped (v1)

Retention is a *user policy*, not a pricing tier. Attachment bytes live in
per-instance blob cores (`space/blobs.ts`) and move to a peer only on
request; policies (`domain/policies.ts` + the `/storage` UI) are per-device:
upload cap, auto-download size + recency, cache budget with LRU eviction.

Still open:
- **Recent-only sync of the log itself.** Ops are tiny JSON, so full log
  replication is cheap today; windowed history needs per-epoch cores —
  revisit when spaces get big.
- **Relay/seed toggle.** Corestore serves any core it holds to any space
  member; per-core serve control needs deeper Pears surgery.

## 3. Abuse & malicious-content defenses — shipped (v1)

Done: content-addressed blobs (sha256 in the op, verified on fetch, dropped
on mismatch); MIME magic-byte sniffing on upload (spoofed media demoted to
plain downloads, never rendered); executable-type warnings; `nosniff` +
attachment disposition on serving; blocked authors' files are never
auto-fetched.

Still open:
- Out of scope for now: reputation systems, automated scanning.
(Writer revocation shipped 2026-07-06 with the roles + cryptographic
revocation slice — see §7.)

## 4. Desktop app (Electron) — shipped (v1)

`apps/desktop` runs the server in-process, stores data under the OS per-user
dir, and packages with electron-builder (`pnpm --filter desktop run dist`).
Still to do, in rough order:

- app icon, code signing + notarization (required for sharing outside dev)
- trim package size (prebuilds for other platforms ride along)
- background node (sync while closed, tray, native notifications)
- manage local AI sidecars (Ollama, Parakeet)
- filesystem access for §5
- auto-update — not until there are users.

## 5. Local files, repos & docs integration — REMOVED (2026-07-05)

The library feature (local folder/repo indexing into Ask) shipped as v1 and
was then deliberately removed in the product refocus: Frith is a **basic,
intuitive chat + file-sharing space** first. The code lives in git history
if the idea returns; Ask still searches messages, people, threads, and
shared files.

## 6. Security foundation — shipped (2026-07-05)

DESIGN.md §17: encryption at rest (OS-keychain-held master key; encrypted
registry, log, and blob cores for new spaces), per-user root identity keys
certifying device keys (link a second device with a handoff code, revoke a
stolen one), and the dev/prod auth split (`FRITH_MODE` — dev keeps the casual
cookie login). Plus `apps/seeder`: a headless always-on peer, the self-host
answer to "what if nobody's laptop is online?" and the base for a hosted
(paid) sync service later.

## 7. Roles + cryptographic revocation — shipped (2026-07-06)

DESIGN.md §18: owner/admin roles as signed ops; evicting a member rotates
every content key they could read (space + their private channels) and rolls
the invite through the log so the old QR dies on every admitting device.
Message bodies (sent and scheduled), attachment names, and attachment bytes
encrypt under per-domain content keys; removing someone from a private
channel rotates just that channel. Privileged routes require auth; the
pre-login surface is an enumerated list. Honest limits documented in §18
(metadata visible to a removed-but-replicating device; collusion).

Next, in order:
1. **Blob purge on eviction** — revoked identities' cached blobs evicted from
   honest peers' disks (today only new content is locked).
2. **Fingerprint verification UX** — compare short codes to verify a
   teammate's identity.
3. **Mobile (native, Pears stack)** — Keet proves it's viable; phone = light
   peer + seeder + push-wake relay (DESIGN.md §17).

## Sequencing rationale

Website first (cheap, validates interest) → policies (core promise of the
pitch, pure P2P work) → Electron (unlocks filesystem + background node) →
security foundation (trust is the product) → roles/channel keys → mobile.
