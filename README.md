# Lore

A team chat platform where the accumulated knowledge is the product — the
institutional lore that today lives in people's heads and dies in scrollback.
See
[DESIGN.md](DESIGN.md) for the full concept and [wireframes.html](wireframes.html)
for the target UI.

## Quickstart

Requires Node ≥ 22, pnpm, and Docker.

```sh
pnpm install
pnpm db:up        # start Postgres (docker compose) and wait for it
pnpm db:migrate   # apply schema migrations
pnpm seed         # load the fictional Acme corpus
pnpm dev          # API on :3001, web on :5173
```

Open http://localhost:5173 and pick a user (dev auth — no passwords locally).
Log in as **Tomas Novak** for the new-hire perspective the product is designed
around.

## Layout

- `apps/server` — Fastify API + WebSocket realtime, Drizzle ORM, Postgres
- `apps/web` — React (Vite) client
- `packages/shared` — DTO and realtime-event types shared end-to-end
- `apps/server/seed/corpus.json` — the checked-in fictional company: coherent
  storylines (a migration, an incident, a private channel, a DM) that later
  double as the retrieval eval set

## Two instances, peer-to-peer

Run the full app twice on one machine and let public channels sync over
Hyperswarm (no server between them — messages are signed and verified):

```sh
# terminal 1 — instance A on :5173
LORE_P2P_ROOM=demo pnpm dev

# terminal 2 — instance B on :5174 (own database, own P2P identity)
LORE_P2P_ROOM=demo pnpm dev:peer
```

Give the DHT ~10–30s to connect (watch for `[p2p] peer connected` in the
server logs; starting the instances a few seconds apart helps). Log in as
different people and chat across instances. v0 scope: public channels only,
live messages only — DMs and private channels never leave an instance.

## Quality gates

```sh
pnpm check   # typecheck + lint + tests + dead-code analysis (fallow)
```

Tests run against a real Postgres (`app_test` database, auto-created) because
the ACL logic lives in SQL — the ACL suite in `apps/server/test/api.test.ts`
asserts a user can never read content from channels they can't access. Keep it
green; everything else is negotiable.
