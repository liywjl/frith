#!/usr/bin/env bash
# Dev = the desktop app. Boots the server (tsx watch) and the web client
# (vite, HMR), then opens the Electron window on the vite URL. Closing the
# window tears everything down. Browser-only iteration: pnpm dev:web.
set -euo pipefail
cd "$(dirname "$0")/.."

# Default ports, sliding upward when something else (another project's dev
# server, a second Lore instance) already holds them.
pick_port() {
  local p=$1
  while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p + 1)); done
  echo "$p"
}
API_PORT=$(pick_port "${LORE_API_PORT:-3001}")
WEB_PORT=$(pick_port "${LORE_WEB_PORT:-5173}")

trap 'kill 0' EXIT
(cd apps/server && PORT=$API_PORT pnpm exec tsx watch src/index.ts) &
(cd apps/web && LORE_API_PORT=$API_PORT pnpm exec vite --port "$WEB_PORT" --strictPort) &

# vite may bind only ::1, so probe via localhost (resolves both families)
until curl -sf -o /dev/null "http://localhost:$WEB_PORT"; do sleep 0.3; done
cd apps/desktop
node build.mjs --dev
LORE_DEV_URL="http://localhost:$WEB_PORT" pnpm exec electron .
