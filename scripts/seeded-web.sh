#!/usr/bin/env bash
# Web client for the disposable seeded instance (pairs with seeded-api.sh).
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

# Some non-interactive shells default to an ancient nvm node; pick a modern one.
if [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  latest=$(ls -d "$HOME/.nvm/versions/node"/v2*/bin 2>/dev/null | sort -V | tail -1 || true)
  [[ -n "${latest:-}" ]] && export PATH="$latest:$PATH"
fi

FRITH_API_PORT="${FRITH_API_PORT:-3211}" exec pnpm exec vite --port "${WEB_PORT:-5374}" --strictPort
