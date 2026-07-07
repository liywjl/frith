# space/ — the P2P storage core

There is no database. A workspace ("space") is one **Autobase**: an
append-only, multi-writer log replicated directly between the machines of its
members. This folder is the only place that touches the P2P stack.

| file | role |
| --- | --- |
| [space.ts](space.ts) | Lifecycle of the one open space — create/join/open, append ops, admit members, bind/revoke identity devices. Wires the four Pears modules below; no custom protocol. |
| [state.ts](state.ts) | The `Op` union (every kind of write in the app) and `FrithState`, the reducer that folds the log into in-memory state — including identity: root keys, device bindings, revocations, message `verified` flags. |
| [blobs.ts](blobs.ts) | Attachment bytes: per-instance Hyperblobs cores, fetched sparsely from peers on demand, verified by sha256, evicted LRU under a device budget. |
| [keys.ts](keys.ts) | Device key custody: the master key (env / 0600 file; the desktop shell wraps it with the OS keychain) and the AES-GCM envelope that encrypts the registry. |
| [modules.d.ts](modules.d.ts) | Minimal typings for the Pears modules (no official `@types`). |

## What gets stored

Every mutation — message, reaction, profile edit, channel, read receipt — is
an `Op`: a small JSON value appended to the log. Nothing is updated in place;
current state is whatever `FrithState` says after replaying the log, and the
reducer is deterministic, so every peer materializes identical state.

**Attachment bytes are not in the log** — only their metadata op is (name,
sniffed mime, size, sha256, and a blob ref). The bytes live in the uploader's
blob core and move to a peer only when that peer asks: automatically when the
file fits the device's policies (size, recency — see `domain/policies.ts`),
or on an explicit click. Fetched bytes are hash-verified against the op and
count against a per-device cache budget with least-recently-used eviction.
Ops are tiny, so the full log replicating everywhere is cheap; the heavy
data is exactly the part you control.

Two honest caveats:

- **Private channels are logically private, not yet physically.** Every
  member replicates the whole log; the API layer enforces who can *read*
  what (guarded by the ACL test suite). Physical ACL — separate cores with
  their own keys — is on the [roadmap](../../../../ROADMAP.md).
- **Encryption applies to spaces created from this version.** Blocks are
  encrypted with a shared space key (minted at create, delivered inside the
  blind-pairing handshake) — at rest and on the wire. Hypercore's merkle
  tree is built over ciphertext, so an older plaintext space can't be
  encrypted in place; it still opens, it just stays plaintext.

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
linearizes → `FrithState.apply` runs on every machine, identically → each
server fans out to its own browser over websocket.

When writers merge, Autobase may reorder the view (a `truncate` event). Our
state isn't reversible, so `space.ts` rebuilds by replaying from scratch.

## On disk

Under `.frith-data/` (override with `$FRITH_DATA`; the second dev instance uses
`.frith-data-peer/`):

- `spaces.json` — the registry: every space this instance belongs to (name,
  autobase key, invite, the space's log-encryption key, identity seeds) and
  which one is open. **Encrypted at rest** (AES-GCM under the device master
  key — see `keys.ts`); a legacy plaintext registry is re-encrypted on the
  next write. One space is open at a time; the rail in the app switches by
  closing one log and opening another. The founder's pairing credentials
  live here too; only a credential holder can admit new members. (A legacy
  single-space `space.json` migrates on first open.)
- `master.key` — the device master key (0600), unless the desktop shell
  provides it via the OS keychain (`FRITH_MASTER_KEY`).
- `<dir>/` — one Corestore directory per space this instance has created or
  joined.

Deleting the directory makes this instance forget everything; any other
member still holds the full space and can invite you back.
