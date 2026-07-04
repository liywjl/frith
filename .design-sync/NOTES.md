# design-sync notes — Lore (web components)

## Shape & entry
- **Package shape, no dist.** The DS is the app's own React components in `apps/web/src/components/` (not a published library). There is no build that emits a component-library `dist/`, so we bundle a **hand-written barrel entry**: `apps/web/.ds-entry.tsx` (gitignored build artifact). It re-exports the 9 components + `UserActionsContext`.
- Build command (run from repo root):
  ```
  node .ds-sync/package-build.mjs --config design-sync.config.json \
    --node-modules ./apps/web/node_modules --entry ./apps/web/.ds-entry.tsx --out ./ds-bundle
  node .ds-sync/package-validate.mjs ./ds-bundle
  ```
- `--node-modules ./apps/web/node_modules` is where `react`/`@app/shared` resolve. `--entry` makes the converter walk up to `apps/web/package.json` (name `web` → `cfg.pkg`).

## Contracts (dtsPropsFor)
- No shipped `.d.ts`, so the extractor emits permissive `[key: string]: unknown` stubs. We hand-wrote real prop bodies in `cfg.dtsPropsFor` for all 9, **self-contained** (only `React` + built-ins; DTO shapes inlined, `Props['field']` self-refs used to stay DRY). If a component's source props change, update `dtsPropsFor` to match — it is NOT auto-synced.

## Provider / context
- `Message`, `UserHover`, `Sidebar` call `useUserActions()`, which throws without `UserActionsContext`.
- `cfg.provider` does **not** work here: `emit.mjs` only applies the provider if its name is in the static `exported` set, which is empty in no-dist mode (built from `.d.ts`). So the provider wrapping is silently dropped and previews render empty.
- **Fix used:** wrap the 3 context previews in `<UserActionsContext.Provider value={actions}>` **inside their own `.design-sync/previews/*.tsx`** (import `UserActionsContext` from `'web'`), with realistic action fns (`getUser` returns a real user, `isOnline` → true). This is more faithful than a static `{value:{}}` anyway. Do NOT re-add `cfg.provider`.

## Assets / fonts
- No brand font files — `--mono` is a system monospace stack; default theme tokens live in `:root` (theme `paper`), so `cfg.cssEntry: src/styles.css` needs no `data-theme` attribute.
- Message `WithImage` uses an **inline SVG data-URI** (not a network URL) so the render check stays offline/deterministic.

## Interaction-only states skipped (documented, not failures)
- Composer slash-menu / emoji-menu (state-driven, needs typing).
- UserHover profile card (appears on hover only) — previews show the trigger element.

## Re-sync risks (what can silently go stale)
- **`.ds-entry.tsx` is gitignored** — it must be recreated on a fresh clone before building (regenerate the barrel: 9 `export { X } from './src/components/X'` + `export { UserActionsContext } from './src/lib/userActions'`). Consider committing it if re-syncs get frequent.
- **`dtsPropsFor` is a hand-maintained mirror** of the component prop types. If someone edits a component's props in source, the uploaded `.d.ts` will lag until `dtsPropsFor` is updated — there is no check that catches drift.
- The mock `actions`/DTO fixtures in the 3 provider previews are inlined; if `UserDto`/`UserActions` in `@app/shared` change shape, update those previews.
- Scope is the 9 `components/` atoms only — `views/`, `panels/`, `modals/` are page-level compositions, intentionally excluded.
- `[PROVIDER_UNEXPORTED]` will NOT appear now (provider removed from config). If it reappears, someone re-added `cfg.provider` — remove it (see Provider section).
