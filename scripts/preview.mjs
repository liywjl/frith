// Boot a preview instance — a third set of ports, separate from `pnpm dev`
// (:3001/:5173) and `pnpm dev:peer` (:3002/:5174), on its own data dir.
//
//   node scripts/preview.mjs server   # :3210
//   node scripts/preview.mjs web      # :5273, proxying to :3210
//
// This exists because .claude/launch.json cannot set environment variables
// directly; it previously wrapped these in `bash -c`, which is not available
// on Windows.

import { join } from 'node:path'
import { repoRoot, pnpmExec, teardownOnExit } from './lib.mjs'

teardownOnExit()

const target = process.argv[2]

const apps = {
  server: {
    cwd: 'apps/server',
    args: ['tsx', 'watch', 'src/index.ts'],
    env: {
      FRITH_DATA: '.frith-data-preview',
      FRITH_FILES: '.data/uploads-preview',
      PORT: '3210',
    },
  },
  web: {
    cwd: 'apps/web',
    args: ['vite', '--port', '5273', '--strictPort'],
    env: { FRITH_API_PORT: '3210' },
  },
}

const app = apps[target]
if (!app) {
  console.error(
    `usage: node scripts/preview.mjs <${Object.keys(apps).join('|')}>`,
  )
  process.exit(1)
}

pnpmExec(app.args, { cwd: join(repoRoot, app.cwd), env: app.env })
