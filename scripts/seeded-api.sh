#!/usr/bin/env bash
# Disposable seeded API instance for UX work (preview tools / ux-run).
# Wipes its own data dir on every boot, seeds the three demo spaces, then
# serves until killed. Own data dir + port so it never touches real dev data.
set -euo pipefail
cd "$(dirname "$0")/.."

# Some non-interactive shells default to an ancient nvm node; pick a modern one.
if [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  latest=$(ls -d "$HOME/.nvm/versions/node"/v2*/bin 2>/dev/null | sort -V | tail -1 || true)
  [[ -n "${latest:-}" ]] && export PATH="$latest:$PATH"
fi

PORT="${PORT:-3211}"
rm -rf apps/server/.frith-data-uxlens apps/server/.data/uploads-uxlens

(cd apps/server && FRITH_DATA=.frith-data-uxlens FRITH_FILES=.data/uploads-uxlens PORT=$PORT pnpm exec tsx watch src/index.ts) &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

until curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/spaces"; do sleep 0.3; done
PORT=$PORT ./scripts/demo-spaces.sh
wait $SRV
