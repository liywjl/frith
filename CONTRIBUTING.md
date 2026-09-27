# Contributing

Thanks for taking an interest in Frith.

## Setup

Requires Node ≥ 22 and pnpm ≥ 10.

```sh
pnpm install
pnpm dev          # desktop app over hot-reloading server + client
pnpm dev:seeded   # same, on a throwaway pre-seeded data dir
```

To exercise the peer-to-peer path, run two instances and pair them — see
"Two instances, peer-to-peer" in the [README](README.md).

## Before you open a PR

```sh
pnpm check   # typecheck + lint + tests + dead-code analysis
```

Checks run locally before a PR. Tests run against a real scratch-dir Autobase
space. The ACL suite in
`apps/server/test/api.test.ts` asserts a user can never read content from
channels they can't access — keep it green; everything else is negotiable.

For a Mac release, run `pnpm check`, then build installers locally with
`bash apps/desktop/scripts/dist.sh --mac --arm64 --publish=never` and
`bash apps/desktop/scripts/dist.sh --mac --x64 --publish=never`. Verify the
packaged apps and upload the files from `apps/desktop/release/` manually.

## Scope

Check [ROADMAP.md](ROADMAP.md) before starting anything large — it explains
what's next and, more importantly, why. For security-relevant changes read
[HARDENING.md](HARDENING.md) and [SECURITY.md](SECURITY.md) first. If you're
unsure whether something fits, open an issue and ask before writing code.
