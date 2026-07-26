// Dev = the desktop app. Boots the server (tsx watch) and the web client
// (vite, HMR), then opens the Electron window on the vite URL. Closing the
// window tears everything down. Browser-only iteration: pnpm dev:web.
//
// Cross-platform replacement for the previous dev.sh — see scripts/lib.mjs for
// the lsof/curl/trap equivalents.

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  repoRoot,
  pickPort,
  pnpmExec,
  nodeScript,
  waitForHttp,
  teardownOnExit,
} from './lib.mjs'

const shutdown = teardownOnExit()

// --seeded: boot on a throwaway data dir, wiped and re-seeded with the three
// demo spaces every run — an instant disposable instance for testing.
const seeded = process.argv.includes('--seeded')

const extraEnv = {}
if (seeded) {
  extraEnv.FRITH_DATA = '.frith-data-seeded'
  extraEnv.FRITH_FILES = '.data/uploads-seeded'
  for (const dir of ['.frith-data-seeded', '.data/uploads-seeded']) {
    rmSync(join(repoRoot, 'apps/server', dir), { recursive: true, force: true })
  }
}

// Default ports, sliding upward when something else (another project's dev
// server, a second Frith instance) already holds them.
const apiPort = await pickPort(process.env.FRITH_API_PORT ?? 3001)
const webPort = await pickPort(process.env.FRITH_WEB_PORT ?? 5173)

pnpmExec(['tsx', 'watch', 'src/index.ts'], {
  cwd: join(repoRoot, 'apps/server'),
  env: { ...extraEnv, PORT: String(apiPort) },
})

pnpmExec(['vite', '--port', String(webPort), '--strictPort'], {
  cwd: join(repoRoot, 'apps/web'),
  env: { ...extraEnv, FRITH_API_PORT: String(apiPort) },
})

await waitForHttp(`http://localhost:${webPort}`)

if (seeded) {
  await waitForHttp(`http://localhost:${apiPort}/api/spaces`)
  await nodeScript(join(repoRoot, 'scripts/demo-spaces.mjs'), [], {
    cwd: repoRoot,
    env: { PORT: String(apiPort) },
  })
}

const desktop = join(repoRoot, 'apps/desktop')
await nodeScript('build.mjs', ['--dev'], { cwd: desktop })

const electron = pnpmExec(['electron', '.'], {
  cwd: desktop,
  env: { ...extraEnv, FRITH_DEV_URL: `http://localhost:${webPort}` },
})

// Closing the window tears everything down.
electron.on('exit', (code) => shutdown(code ?? 0))
