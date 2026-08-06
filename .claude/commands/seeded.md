---
description: Boot the disposable seeded demo instance (fresh data every run) for UI/UX work
---

Start the seeded dev instance and hand the user the URL:

1. `preview_start` the `api-seeded` config (wipes `.frith-data-seeded`, re-seeds the three demo spaces — Acme, Blade Crew, Static Bloom). Wait for it to be up.
2. `preview_start` the `web-seeded` config.
3. Verify the app loads with `preview_snapshot` and that there are no console errors.
4. Tell the user it's live at http://localhost:5374, on throwaway data.

If the user just wants to browse it themselves outside Claude, the equivalent terminal command is `pnpm dev:seeded:web` (or `pnpm dev:seeded` for the Electron shell).
