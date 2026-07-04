# desktop

The Electron shell: your P2P node as an app. It runs the full server
in-process — the same Autobase log, Hyperswarm sync, and HTTP API as dev —
and opens a window on the web client, served from the same origin. No code
changes in either; the shell only decides *where things live*:

- data → the OS per-user dir (`~/Library/Application Support/Lore` on macOS):
  `space/` for the Autobase log, `uploads/` for attachment bytes
- web client → the built `web/dist`, bundled next to `main.js`

The Pears native modules ship N-API prebuilds, which are ABI-stable across
Node and Electron — no rebuilds, no toolchain.

## Run it

```sh
pnpm --filter desktop build   # builds web, bundles main.js via esbuild
pnpm --filter desktop start   # opens the app
```

Set `LORE_HOME=/some/dir` to relocate all data (handy for a second instance).

## Ship it

```sh
pnpm --filter desktop run dist         # installable artifacts in release/
pnpm --filter desktop run dist --dir   # just the unpacked app, faster
```

[scripts/dist.sh](scripts/dist.sh): esbuild bundles the app (server included,
Pears modules external), `pnpm deploy` materializes a self-contained copy
with real `node_modules`, electron-builder packs it. Native `.node` files are
asar-unpacked so `process.dlopen` can load them.

Not done yet: app icon, code signing/notarization, auto-update, tray/
background mode — see [ROADMAP.md](../../ROADMAP.md) §4.
