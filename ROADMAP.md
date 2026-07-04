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
- **Writer revocation** — needs a roles/admin model first (today any member
  is an equal writer).
- Out of scope for now: reputation systems, automated scanning.

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

## 5. Local files, repos & docs integration — shipped (v1)

Point Lore at local folders / git repos (`domain/library.ts`, `/library` UI):
lexical index over text/code/docs plus git commit history, cited in Ask next
to chat evidence. Indexing is device-local; nothing enters the space's log.

Still open:
- **Embeddings + synthesis** via local models (Ollama) — the lexical index
  keeps the result shapes; models slot in on top.
- **Sharing an index into a space** as an explicit act (§2 layers apply).
- **Graph search**: people ↔ threads ↔ decisions ↔ commits ↔ docs as one
  graph. Start with the edges we already have (mentions, replies, file
  shares, commit authorship) before inventing an ontology.
- Watch mode: re-index on file change instead of manual re-index.

## Sequencing rationale

Website first (cheap, validates interest) → policies (core promise of the
pitch, pure P2P work) → Electron (unlocks filesystem + background node) →
local-file intelligence (the "wow", needs everything above).
