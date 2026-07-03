#!/usr/bin/env bash
# Boot a SECOND full Lore instance (own database, own P2P identity) that
# connects to the first over Hyperswarm.
#
#   terminal 1:  LORE_P2P_ROOM=demo pnpm dev        # instance A → :5173
#   terminal 2:  LORE_P2P_ROOM=demo pnpm dev:peer   # instance B → :5174
#
# Log in as different people on each and chat — public channels sync P2P.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${LORE_P2P_ROOM:?set LORE_P2P_ROOM to the same value on both instances}"

# Second database in the same local Postgres container.
docker compose exec -T db psql -U app -d app -tc \
  "select 1 from pg_database where datname = 'app2'" | grep -q 1 ||
  docker compose exec -T db psql -U app -d app -c 'create database app2'

export DATABASE_URL=postgres://app:app@localhost:5433/app2
(cd apps/server && pnpm exec drizzle-kit migrate)

# Seed only on first run so instance B keeps its state between restarts.
USERS=$(docker compose exec -T db psql -U app -d app2 -tc 'select count(*) from users' | tr -d ' ')
if [ "$USERS" = "0" ]; then
  (cd apps/server && pnpm exec tsx scripts/seed.ts)
fi

export PORT=3002
export LORE_API_PORT=3002
export LORE_P2P_DATA=.lore-p2p-peer

trap 'kill 0' EXIT
(cd apps/server && pnpm exec tsx watch src/index.ts) &
(cd apps/web && pnpm exec vite --port 5174) &
wait
