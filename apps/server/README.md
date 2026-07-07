# server

Fastify server each user runs locally: it holds that user's replica of the
space and serves the web client. Three layers, dependencies point downward:

```
api/      HTTP routes + websocket        (edge: parse, authorize, respond)
   ↓
domain/   application logic              (queries, commands, features)
   ↓
space/    P2P storage core               (Autobase log — see space/README.md)
```

## Map

- [src/index.ts](src/index.ts) — entry: start the server, run the timers
  (status expiry, schedule-send).
- [src/api/routes.ts](src/api/routes.ts) — every HTTP endpoint and the
  websocket upgrade. Auth is a dev cookie for now. All ACL checks happen
  here, backed by `domain/store.ts`.
- [src/api/realtime.ts](src/api/realtime.ts) — fan-out of `ServerEvent`s to
  connected sockets (`'all'` or a user-id list).
- [src/domain/store.ts](src/domain/store.ts) — the data-access layer: reads
  materialized state, writes by appending ops. The only file that talks to
  `space/` for data.
- [src/domain/ask.ts](src/domain/ask.ts) — the Ask surface: keyword retrieval
  over messages visible to the asker, shaped into cited answers.
- [src/domain/policies.ts](src/domain/policies.ts) — device-local storage
  policies (upload cap, auto-download size/recency, cache budget). Never in
  the log: what you store is your call, not the space's.
- [src/domain/files.ts](src/domain/files.ts) — file safety: magic-byte
  sniffing (bytes over declared mime) and dangerous-type flagging.
- [src/domain/artifacts.ts](src/domain/artifacts.ts) — extracts links/paths
  ("artifacts") from message bodies.
- [src/domain/calls.ts](src/domain/calls.ts) — campfire membership +
  signaling relay; media flows peer-to-peer over WebRTC.
- [src/domain/scheduler.ts](src/domain/scheduler.ts) — delivers due
  schedule-send messages.
- [src/domain/seed.ts](src/domain/seed.ts) — loads `seed/corpus.json` (the
  fictional Acme company) into the space.
- [src/space/](src/space/README.md) — **how the P2P storage works: start here.**

## Tests

`test/api.test.ts` runs the real server against a scratch-dir space. The ACL
suite asserts a user can never read content from channels they can't access —
search and files included. Keep it green; everything else is negotiable.
