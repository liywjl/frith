# space/ — the P2P storage core

There is no database. A workspace ("space") is one **Autobase**: an
append-only, multi-writer log replicated directly between the machines of its
members. This folder is the only place that touches the P2P stack.

| file | role |
| --- | --- |
| [space.ts](space.ts) | Lifecycle of the one open space — create/join/open, append ops, admit members. Wires the four Pears modules below; no custom protocol. |
| [state.ts](state.ts) | The `Op` union (every kind of write in the app) and `LoreState`, the reducer that folds the log into in-memory state. |
| [blobs.ts](blobs.ts) | Attachment bytes: per-instance Hyperblobs cores, fetched sparsely from peers on demand, verified by sha256, evicted LRU under a device budget. |
| [modules.d.ts](modules.d.ts) | Minimal typings for the Pears modules (no official `@types`). |

## What gets stored

Every mutation — message, reaction, profile edit, channel, read receipt — is
an `Op`: a small JSON value appended to the log. Nothing is updated in place;
current state is whatever `LoreState` says after replaying the log, and the
reducer is deterministic, so every peer materializes identical state.

**Attachment bytes are not in the log** — only their metadata op is (name,
sniffed mime, size, sha256, and a blob ref). The bytes live in the uploader's
blob core and move to a peer only when that peer asks: automatically when the
file fits the device's policies (size, recency — see `domain/policies.ts`),
or on an explicit click. Fetched bytes are hash-verified against the op and
count against a per-device cache budget with least-recently-used eviction.
Ops are tiny, so the full log replicating everywhere is cheap; the heavy
data is exactly the part you control.

One honest caveat:

- **Private channels are logically private, not yet physically.** Every
  member replicates the whole log; the API layer enforces who can *read*
  what (guarded by the ACL test suite). Physical ACL — separate cores with
  their own keys — is on the [roadmap](../../../../ROADMAP.md).

## How it gets stored and synced

Four proven modules, one job each:

- **Corestore** — persistence: append-only logs on disk.
- **Autobase** — multi-writer: merges every member's local log into one
  linearized view all peers agree on.
- **Hyperswarm** — replication: peers find each other by the space's
  discovery key on a DHT and sync over encrypted connections.
- **blind-pairing** — membership: an invite is a capability; redeeming it
  makes an admitting member append an `add-writer` op for your log.

Life of a message: a route appends an op → Autobase writes it to this
machine's local core → Hyperswarm replicates cores → each peer's Autobase
linearizes → `LoreState.apply` runs on every machine, identically → each
server fans out to its own browser over websocket.

When writers merge, Autobase may reorder the view (a `truncate` event). Our
state isn't reversible, so `space.ts` rebuilds by replaying from scratch.

## On disk

Under `.lore-data/` (override with `$LORE_DATA`; the second dev instance uses
`.lore-data-peer/`):

- `spaces.json` — the registry: every space this instance belongs to (name,
  autobase key, invite) and which one is open. One space is open at a time;
  the rail in the app switches by closing one log and opening another. The
  founder's pairing credentials live here too; only a credential holder can
  admit new members. (A legacy single-space `space.json` migrates on first
  open.)
- `<dir>/` — one Corestore directory per space this instance has created or
  joined.

Deleting the directory makes this instance forget everything; any other
member still holds the full space and can invite you back.
