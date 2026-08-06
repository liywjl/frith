# Frith

A team chat platform where the accumulated knowledge is the product — the
institutional memory that today lives in people's heads and dies in scrollback.
See
[DESIGN.md](DESIGN.md) for the full concept and [wireframes.html](wireframes.html)
for the target UI.

## Quickstart

Requires Node ≥ 22 and pnpm. No database, no Docker — the datastore is a
peer-to-peer Autobase log under `.frith-data/`.

```sh
pnpm install
pnpm dev                  # opens the DESKTOP app (server :3001 + vite :5173 under it)
pnpm dev:seeded           # same, but on a throwaway data dir that is wiped and
                          # re-seeded with the three demo spaces every run —
                          # an instant disposable instance for testing
node scripts/demo-spaces.mjs  # seed the demo spaces into YOUR instance instead:
                          # Acme (work), a rollerblading crew, and a band —
                          # hop between them with the rail on the far left
```

The desktop app is the product; `pnpm dev` opens its Electron window over a
hot-reloading server and client, so code changes land without restarting it.
Prefer a browser? `pnpm dev:web` runs just the server + web client on
http://localhost:5173. Either way, pick a user (dev auth — no passwords
locally); log in as **Tomas Novak** for the new-hire perspective the product
is designed around. `pnpm --filter desktop run dist` packages the real,
shareable app.

## Layout

Each folder has its own short README; the deep one is
[`apps/server/src/space/`](apps/server/src/space/README.md) — how the P2P
storage works, what gets stored, and where.

- [`apps/server`](apps/server/README.md) — Fastify API + WebSocket realtime
  over the Autobase log (`api/` → `domain/` → `space/`)
- [`apps/web`](apps/web/README.md) — React (Vite) client
  (`views/`, `panels/`, `modals/`, `components/`, `lib/`)
- [`apps/desktop`](apps/desktop/README.md) — Electron shell: the server
  in-process, data under the OS per-user dir, packaged with electron-builder
- [`apps/mobile`](apps/mobile/README.md) — React Native app: the same P2P
  core in a [Bare](https://docs.pears.com/reference/bare/bare-kit/) worklet,
  RPC over IPC instead of HTTP, data in the app sandbox
- [`packages/shared`](packages/shared/README.md) — DTO and realtime-event
  types shared end-to-end
- `apps/server/seed/corpus.json` — the checked-in fictional company: coherent
  storylines (a migration, an incident, a private channel, a DM) that later
  double as the retrieval eval set
- `site/` — the static landing page; `ROADMAP.md` — what's next and why

## Two instances, peer-to-peer

The app is peer-to-peer end to end: every workspace ("space") is an
[Autobase](https://docs.pears.com) — a multi-writer log replicated over
Hyperswarm, with [blind-pairing](https://github.com/holepunchto/blind-pairing)
turning invites into writers. Run it twice on one machine:

```sh
# terminal 1 — instance A on :5173
pnpm dev

# terminal 2 — instance B on :5174 (own space data under .frith-data-peer/)
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

## Contributing & license

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get set up
and [SECURITY.md](SECURITY.md) for how to report vulnerabilities (and an
honest statement of the project's security maturity). Licensed under
[Apache-2.0](LICENSE).
