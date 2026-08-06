// The disposable seeded instance used for UI/UX work (the preview tools and
// the ux-run flow drive it). Its own data dir and its own ports, so it never
// touches real dev data, and it is wiped and re-seeded on every boot.
//
//   node scripts/seeded.mjs api   # :3211, wipes + seeds the three demo spaces
//   node scripts/seeded.mjs web   # :5374, proxying to :3211
//
// Cross-platform replacement for the previous seeded-api.sh / seeded-web.sh.
// Same reason preview.mjs exists: .claude/launch.json cannot set environment
// variables directly, and the `bash -c` wrapper it used instead is not
// available on Windows.

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  repoRoot,
  pnpmExec,
  nodeScript,
  waitForHttp,
  teardownOnExit,
} from './lib.mjs'

teardownOnExit()

const target = process.argv[2]
// PORT is "the port THIS process listens on" — the launcher sets it per
// process, so it is 5374 for the web side. Which API the client proxies to is
// a separate question and needs its own variable, or the web server ends up
// proxying /api to itself.
const ownPort = process.env.PORT ?? (target === 'web' ? '5374' : '3211')
const apiPort = process.env.FRITH_API_PORT ?? '3211'

if (target === 'api') {
  // Throwaway by design: every boot starts from nothing, so the demo data is
  // always exactly what the seed corpus says it is.
  for (const dir of ['.frith-data-seeded', '.data/uploads-seeded']) {
    rmSync(join(repoRoot, 'apps/server', dir), { recursive: true, force: true })
  }

  pnpmExec(['tsx', 'watch', 'src/index.ts'], {
    cwd: join(repoRoot, 'apps/server'),
    env: {
      FRITH_DATA: '.frith-data-seeded',
      FRITH_FILES: '.data/uploads-seeded',
      PORT: ownPort,
    },
  })

  await waitForHttp(`http://localhost:${ownPort}/api/spaces`)
  await nodeScript(join(repoRoot, 'scripts/demo-spaces.mjs'), [], {
    cwd: repoRoot,
    env: { PORT: ownPort },
  })
} else if (target === 'web') {
  pnpmExec(['vite', '--port', ownPort, '--strictPort'], {
    cwd: join(repoRoot, 'apps/web'),
    env: { FRITH_API_PORT: apiPort },
  })
} else {
  console.error('usage: node scripts/seeded.mjs <api|web>')
  process.exit(1)
}
