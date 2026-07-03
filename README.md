# Lore

A team chat platform where the accumulated knowledge is the product — the
institutional lore that today lives in people's heads and dies in scrollback.
See
[DESIGN.md](DESIGN.md) for the full concept and [wireframes.html](wireframes.html)
for the target UI.

## Quickstart

Requires Node ≥ 22 and pnpm. No database, no Docker — the datastore is a
peer-to-peer Autobase log under `.lore-data/`.

```sh
pnpm install
pnpm dev          # API on :3001, web on :5173
pnpm seed         # load the fictional Acme corpus (server must be running)
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

The app is peer-to-peer end to end: every workspace ("space") is an
[Autobase](https://docs.pears.com) — a multi-writer log replicated over
Hyperswarm, with [blind-pairing](https://github.com/holepunchto/blind-pairing)
turning invites into writers. Run it twice on one machine:

```sh
# terminal 1 — instance A on :5173
pnpm dev

# terminal 2 — instance B on :5174 (own space data under .lore-data-peer/)
pnpm dev:peer
```

Copy the 🛰 invite from instance A and paste it into instance B's
"Join a space" — the entire workspace (people, channels, history) syncs
peer-to-peer, and everything after that is live in both directions.
Current limitation: an instance holding the pairing credentials (the space's
founder, for now) must be online to admit a *new* member; already-joined
members sync with each other regardless.

## Quality gates

```sh
pnpm check   # typecheck + lint + tests + dead-code analysis (fallow)
```

Tests run against a real (scratch-dir) Autobase space. The ACL suite in
`apps/server/test/api.test.ts` asserts a user can never read content from
channels they can't access — search and files included. Keep it green;
everything else is negotiable.
