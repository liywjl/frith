# seeder

A headless, always-on peer for one space. It holds the full log and all
attachment bytes and serves them to any member — so your phone or a
teammate's laptop syncs even when nobody else is online. It has no user and
no API; it never writes to the log.

This is also the self-hosting story: run it on a VPS, a NAS, or a Raspberry
Pi and your space has 24/7 availability without any Frith-operated server.
(A hosted version of exactly this is the future paid offering.)

```sh
# once — needs any member instance online to admit it:
FRITH_SEED_DATA=/var/lib/frith pnpm --filter seeder join "frith:acme:abc123…"

# forever:
FRITH_SEED_DATA=/var/lib/frith pnpm --filter seeder serve
```

What it stores under `$FRITH_SEED_DATA` (default `.frith-seed`): the same
encrypted Corestore a member holds, plus every attachment's bytes (no cache
budget — serving is its whole job). The registry is encrypted with a device
master key (`FRITH_MASTER_KEY` env, or a 0600 `master.key` file it mints).

Honest notes:

- The seeder is admitted like any member, so it holds the space's log
  encryption key: **a seeder host can read the space**. Run it on hardware
  you trust as much as a member's laptop. Blind seeding (serving ciphertext
  without the key) needs per-core serve control — on the roadmap.
- One space per seeder process for now (`join` switches the active space).
