#!/usr/bin/env bash
set -e
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U app -d app >/dev/null 2>&1; then
    echo "postgres ready"
    exit 0
  fi
  sleep 1
done
echo "postgres did not become ready" >&2
exit 1
