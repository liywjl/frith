#!/usr/bin/env bash
# Seed the full demo: three spaces on one instance — Acme (work), Blade Crew
# (rollerblading friends), Static Bloom (a band). Server must be running.
set -euo pipefail
PORT="${PORT:-3001}"
api="http://localhost:$PORT/api"

home_dir=$(curl -sf "$api/spaces" | python3 -c "import json,sys; print(json.load(sys.stdin)['active'])")
curl -sf -X POST "$api/dev/seed" -H 'content-type: application/json' -d '{"corpus":"acme"}' >/dev/null
echo "seeded acme into current space ($home_dir)"

for pair in "Blade Crew 🛼:skate" "Static Bloom 🎸:band"; do
  name="${pair%%:*}"; corpus="${pair##*:}"
  if curl -sf "$api/spaces" | grep -q "\"$name\""; then
    echo "$name already exists — skipping"
    continue
  fi
  curl -sf -X POST "$api/space" -H 'content-type: application/json' -d "{\"name\":\"$name\"}" >/dev/null
  curl -sf -X POST "$api/dev/seed" -H 'content-type: application/json' -d "{\"corpus\":\"$corpus\"}" >/dev/null
  echo "created + seeded $name"
done

curl -sf -X POST "$api/spaces/switch" -H 'content-type: application/json' -d "{\"dir\":\"$home_dir\"}" >/dev/null
echo "back on the first space — open the app and use the rail to hop around"
