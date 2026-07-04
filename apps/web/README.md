# web

React (Vite) client. It talks only to its own local server — REST via
[lib/api.ts](src/lib/api.ts), live updates via a websocket
([lib/useRealtime.ts](src/lib/useRealtime.ts)). P2P sync happens a layer
below, in the server; the client never sees it.

## Folders

A component lives where its name says it does:

- `src/App.tsx` — root: routing between views, session, theme, global state.
- `src/views/` — the main pane, one file per view (Home, Channel, People,
  Profile, Task).
- `src/panels/` — right-hand side panels (Thread, Profile, Ask, Call).
- `src/modals/` — overlays; `Modal.tsx` is the shared shell, the rest are
  one modal each (QuickSwitcher included).
- `src/components/` — shared building blocks (Sidebar, Composer, Message,
  Avatar, Logo, …).
- `src/lib/` — non-visual code: API client, websocket hook, call/WebRTC
  glue, formatting helpers.

`styles.css` is the single stylesheet; themes are CSS-variable palettes on
`:root` (see the `THEMES` list in `@app/shared`).
