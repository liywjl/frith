// Boot a SECOND full Frith instance (own space data, own files) to test P2P.
//
//   terminal 1:  pnpm dev            # instance A → :5173
//   terminal 2:  pnpm dev:peer       # instance B → :5174
//
// Join instance B to A's space via the 🛰 invite — everything syncs P2P.
//
// Cross-platform replacement for the previous dev-peer.sh.

import { join } from 'node:path'
import { repoRoot, pnpmExec, teardownOnExit } from './lib.mjs'

teardownOnExit()

// Fixed ports, unlike dev.mjs: the whole point is a predictable second
// instance sitting alongside the first.
const env = {
  PORT: '3002',
  FRITH_API_PORT: '3002',
  FRITH_DATA: '.frith-data-peer',
  FRITH_FILES: '.data/uploads-peer',
}

pnpmExec(['tsx', 'watch', 'src/index.ts'], {
  cwd: join(repoRoot, 'apps/server'),
  env,
})

pnpmExec(['vite', '--port', '5174'], {
  cwd: join(repoRoot, 'apps/web'),
  env,
})
