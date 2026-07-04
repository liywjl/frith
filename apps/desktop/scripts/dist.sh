#!/usr/bin/env bash
# Build a shareable Lore desktop app into apps/desktop/release/.
# Flow: bundle (web + main) → pnpm deploy a self-contained copy with real
# node_modules (the native P2P modules) → electron-builder packs it.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm build
rm -rf .deploy
pnpm --filter desktop deploy --legacy --prod .deploy
pnpm exec electron-builder "$@"
