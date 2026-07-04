# Roadmap

The chat core (P2P spaces over Autobase/Hyperswarm) works today. This file
scopes what's next, in order. The landing page (`site/`) sells this sequence;
keep the two in sync.

## 1. Landing page & distribution — now

- `site/index.html` — static, self-contained, deployable to any static host
  (GitHub Pages / Cloudflare Pages). No backend; early-access CTA is mailto.
- Later: opt-in **community directory** — a curated list of public spaces
  (itself just a signed Autobase feed, no server needed).

## 2. Storage & sharing policies

The differentiator: retention is a *user policy*, not a pricing tier.

- **Default: recent-only sync.** New members replicate a sliding window
  (e.g. last 90 days / N MB per channel), not the full archive. Autobase
  sparse replication makes this natural — don't build a second sync layer.
- **Backfill on request.** Explicit "load older history" pulls from peers
  holding it, up to a per-space cap the user sets.
- **File-size caps.** Blobs above a threshold (default ~25 MB) are fetched
  lazily on click, never auto-replicated. Hard per-device storage budget with
  LRU eviction for lazily-fetched blobs.
- **Sharing layers**, per user: (a) share into the space, (b) keep local-only,
  (c) willing to *relay/seed* history for others. Three toggles, not a matrix.

## 3. Abuse & malicious-content defenses

- Content-addressed blobs: hash-verified on receipt; corrupt/spoofed data
  doesn't replicate further.
- Writers are explicit (blind-pairing admit) and revocable; a removed writer's
  future ops are ignored by all peers deterministically.
- Block = stop replicating from that peer, not just hide.
- Don't render risky content: no remote images by default, attachments open
  via OS (never executed), MIME sniffing on receipt, warn on executable types.
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

## 5. Local files, repos & docs integration

Prereq: desktop shell (§4). Point Lore at local folders / git repos.

- **Index**, don't copy: embeddings + full-text over docs and code, stored
  locally; sharing an index into a space is an explicit act (§2 layers apply).
- Git-aware: commits, authors, and file history become citable objects in
  Ask answers ("decided in #infra, implemented in abc123").
- **Graph search** (later): people ↔ threads ↔ decisions ↔ commits ↔ docs as
  one graph. Start with the edges we already have (mentions, replies, file
  shares, commit authorship) before inventing an ontology.

## Sequencing rationale

Website first (cheap, validates interest) → policies (core promise of the
pitch, pure P2P work) → Electron (unlocks filesystem + background node) →
local-file intelligence (the "wow", needs everything above).
