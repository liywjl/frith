#!/usr/bin/env bash
# Boot a SECOND full Frith instance (own space data, own files) to test P2P.
#
#   terminal 1:  pnpm dev            # instance A → :5173
#   terminal 2:  pnpm dev:peer       # instance B → :5174
#
# Join instance B to A's space via the 🛰 invite — everything syncs P2P.
set -euo pipefail
cd "$(dirname "$0")/.."

export PORT=3002
export FRITH_API_PORT=3002
export FRITH_DATA=.frith-data-peer
export FRITH_FILES=.data/uploads-peer

trap 'kill 0' EXIT
(cd apps/server && pnpm exec tsx watch src/index.ts) &
(cd apps/web && pnpm exec vite --port 5174) &
wait
