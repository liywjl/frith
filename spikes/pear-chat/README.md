# Lore P2P spike (Pears stack)

A minimal peer-to-peer chat proving out the transport for Lore's desktop
direction: an Electron shell whose backend worker joins a
[Hyperswarm](https://docs.pears.com) topic — peers find each other through
the DHT and talk over end-to-end-encrypted sockets. **No server anywhere.**

Structure mirrors the [Pears chat tutorial](https://docs.pears.com/getting-started/build-a-peer-to-peer-chat/build-a-peer-to-peer-chat/):

- `electron/main.js` — window + spawns the swarm worker (`utilityProcess`)
- `electron/preload.js` — exposes only `window.chat` to the renderer
- `renderer/` — tiny Lore-styled chat UI
- `workers/swarm.js` — Hyperswarm join/relay logic
- `scripts/smoke.mjs` — headless proof: two peers exchange a message

The tutorial runs its worker on Bare via `pear-runtime`; this spike runs the
same Hyperswarm code in an Electron utility process instead, which keeps it
plain-Node debuggable. Moving it onto Bare/Pear later is a mechanical swap.

## Run it

```sh
cd spikes/pear-chat
npm install
npm run smoke     # headless: two peers meet over the DHT and exchange a message
npm start         # open the app; start it twice and the windows chat P2P
```

Two instances on the same machine pair automatically (topic is derived from
your OS username). Set `LORE_ROOM=some-phrase` on both sides to chat across
machines.

## What this proves / what's next

- Proves: peer discovery, encrypted transport, message fan-out — the layer
  that replaces our WebSocket server.
- Next (per DESIGN.md §14): persistence and multi-writer ordering via
  Hypercore/Autobase so history syncs between peers, then mapping Lore's
  messaging plane (channels, threads, profiles) onto those logs.
