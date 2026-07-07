# mobile

Frith on a phone — the same premise as the desktop app: **your P2P node as an
app.** Where the Electron shell runs the server in-process over Node, this
React Native app runs it in a [Bare](https://docs.pears.com/reference/bare/bare-kit/)
worklet — a Bare thread inside the app, via `react-native-bare-kit`. The
Pears stack (Corestore, Autobase, Hyperswarm, blind-pairing) is Bare-native,
so the entire `space/` P2P core and `domain/` logic from
[`apps/server`](../server/README.md) run **unchanged**; only the edge differs:

```
desktop:  web client ── HTTP + websocket ──▶ Fastify (api/) ─▶ domain/ ─▶ space/
mobile:   RN screens ── RPC over BareKit IPC ─▶ worklet/backend.ts ─▶ domain/ ─▶ space/
```

`worklet/backend.ts` mirrors `api/routes.ts` route-for-route (same ACL guards,
same DTOs from `@app/shared`, same op→`ServerEvent` fan-out — pushed over the
IPC pipe instead of a websocket). Auth is the desktop's *production* posture:
this device IS the credential, every call acts as the device's bound user;
you become someone by creating a profile or importing an identity code.

## Local file access — what changes on mobile

Mobile platforms don't give apps a filesystem, they give them a sandbox.
Frith's data model already fits it:

- **Everything lives in the app sandbox** (`<Documents>/frith-data`): the
  Autobase log, the encrypted `spaces.json` registry, `master.key`, blob
  cores. iOS/Android app isolation plays the role the OS user account plays
  on desktop. (Wrapping the master key with Keychain/Keystore is future work,
  like the desktop's safeStorage wrap.)
- **No arbitrary paths, no streaming to disk**: attachment bytes cross the
  RN↔worklet boundary as base64 inside RPC frames (`files.get`,
  `attachments.send`) instead of being served over HTTP. Uploads must come
  through system pickers (photo library / document picker — not wired up
  yet); "open in Finder" has no analogue.
- **Storage policies matter more, not less**: the same device-local policies
  (auto-fetch size/recency, LRU cache budget) decide what this phone stores —
  phones are small, so the sparse-blob design (ops replicate everywhere,
  bytes move on demand) is exactly right here.

## Layout

- `worklet/backend.ts` — the RPC router over the server's domain/space layers
- `worklet/entry.ts` / `worklet/serve.ts` — Bare entry: frames ⇄ backend
- `worklet/shims/crypto.ts` — `node:crypto` for Bare (noble AES-256-GCM /
  sha256 / hkdf + sodium randomness), **byte-compatible** with desktop so
  registries, content envelopes, and sealed blobs open on both
- `common/protocol.ts` — length-prefixed JSON frames both sides speak
- `src/` — the RN app: onboarding (profile / identity import / join / create),
  Home + Ask, channels & threads & reactions, DMs, people, space settings
- `scripts/bundle-worklet.mjs` — esbuild (TS → one ESM file, `node:*` mapped
  to `bare-*`), `bare-pack --preset mobile`, then `bare-link` embeds the
  native addon prebuilds (sodium, udx, rocksdb, …) into react-native-bare-kit's
  ios/android build. bare-pack and bare-link can't walk pnpm's symlinked
  node_modules, so the worklet's externals are first staged into a flat npm
  install under `.worklet/stage` — the same materialization trick the desktop
  packager uses.

## Run it

```sh
pnpm install
pnpm --filter mobile bundle:worklet   # → worklet/app.bundle.mjs + linked addons
pnpm --filter mobile prebuild         # expo prebuild → ios/ + android/
pnpm --filter mobile ios              # or: pnpm --filter mobile android
pnpm --filter mobile ios:seeded       # DEMO: pnpm dev:seeded, phone edition —
                                      # a throwaway data dir wiped and re-seeded
                                      # with the three demo spaces every launch,
                                      # and desktop-dev pick-a-user auth (log in
                                      # as Tomas Novak for the new-hire view)
```

Seeded is a JS-bundle-time switch (`EXPO_PUBLIC_FRITH_SEEDED=1`), so with a
dev client already installed, `pnpm --filter mobile start:seeded` flips the
same app between seeded and normal — each mode keeps its own data dir.

Native side notes: the Pears modules load N-API addons; their npm packages
ship ios/android prebuilds, `bare-pack --linked` records them in the bundle,
and the bundle step writes the matching xcframeworks / jniLibs into
react-native-bare-kit. Order matters: run `bundle:worklet` before the first
build (and re-run it after a fresh `pnpm install`, then `pod install` in
`ios/` — CocoaPods snapshots the vendored framework list). Expo Go can't load
native modules — use the dev client (`expo run:*`).

Pair it with a desktop instance exactly like the README's two-instance demo:
share the 🛰 invite from desktop, paste it into "Join a space" on the phone
(the founder instance must be online to admit), and the workspace syncs
peer-to-peer — live in both directions.

## Verify without a phone

```sh
pnpm --filter mobile smoke        # whole backend + RPC loop under Node
pnpm --filter mobile smoke:bare   # same scenario under the real Bare runtime,
                                  # with the production shims (needs `bare`)
pnpm --filter mobile typecheck
```

Both smokes drive the served RPC surface end-to-end: profile → channels →
encrypted messages → reactions → sealed attachments → private channels →
identity export → Ask.

## Not there yet

Campfires (calls) need react-native-webrtc; image/document pickers for
uploads; QR scan for invites and identity codes; push-style background sync
(the worklet suspends with the app); shared docs UI (the RPC surface exists).
