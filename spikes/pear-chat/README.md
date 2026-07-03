# Lore P2P spike (Pears stack)

A peer-to-peer, **local-first** chat proving out the transport and trust
model for Lore's desktop direction. No server anywhere:

- **Discovery + transport:** [Hyperswarm](https://docs.pears.com) — peers
  find each other via the DHT and talk over end-to-end-encrypted (Noise)
  sockets.
- **Identity:** an ed25519 device keypair, generated on first run, stored
  only on this machine (`~/.lore-p2p/identity.json`, mode 0600). Your
  public key is your identity — no account server.
- **Authenticated messages:** every message is signed by its author and
  verified by receivers before it's stored or shown. Forgeries are dropped.
- **Local persistence + sync:** each room is an append-only JSONL log under
  `~/.lore-p2p/rooms/`. On connect, peers exchange heads (highest seq per
  author) and backfill each other the difference — a late joiner receives
  history from peers, not from a server.

Structure mirrors the [Pears chat tutorial](https://docs.pears.com/getting-started/build-a-peer-to-peer-chat/build-a-peer-to-peer-chat/):
`electron/` (shell + preload bridge), `renderer/` (UI), `workers/swarm.js`
(P2P backend), plus `lib/` (identity, storage) and `scripts/smoke.mjs`.
The tutorial runs its worker on Bare via `pear-runtime`; this spike runs the
same code in an Electron utility process — moving onto Bare later is
mechanical.

## Run it

```sh
cd spikes/pear-chat
npm install
npm run smoke     # headless proof, see below
npm start         # open twice: the windows chat P2P; restart one — history persists
```

Two instances on one machine pair automatically (topic derived from your OS
username). Set `LORE_ROOM=some-phrase` on both sides to chat across machines.

## What `npm run smoke` proves

Runs the real worker end to end:

1. Peer A writes a message **while alone** → persisted to its local disk.
2. Peer B starts later, discovers A over the DHT, and receives that message
   via signed backfill.
3. An attacker joins the topic and sends a message forged as peer A (bad
   signature) → the receiving peer **rejects it**.

## Next (DESIGN.md §14/§16)

Invite-key rooms + signed membership (capability, not guessable topic),
channel content keys, encryption at rest via OS keychain, and the port to
Hypercore/Autobase for proper multi-writer ordering.
