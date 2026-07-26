// Shared helpers for the dev scripts.
//
// These replace the bits of bash the previous *.sh scripts leaned on — lsof,
// curl, `trap 'kill 0' EXIT` — with equivalents that work on Windows as well
// as macOS and Linux.

import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const isWindows = process.platform === 'win32'

/** Repo root, resolved from this file's location rather than the cwd. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** True if a TCP connection to host:port is accepted. */
function canConnect(port, host) {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host })
    const done = (result) => {
      socket.destroy()
      resolvePromise(result)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * True if something is already listening on `port`.
 *
 * Replaces `lsof -nP -iTCP:$p -sTCP:LISTEN`.
 *
 * This connects rather than binds. Bind-testing looks like the obvious check
 * but gets the answer wrong: a wildcard bind does not always collide with a
 * bind to a specific address, so a vite server holding ::1 alone is invisible
 * to a 0.0.0.0 (or even a ::) probe. Connecting asks the question we actually
 * care about — is someone answering on this port — and both loopback families
 * are checked because a dev server may be on either.
 */
async function portInUse(port) {
  const results = await Promise.all([
    canConnect(port, '127.0.0.1'),
    canConnect(port, '::1'),
  ])
  return results.some(Boolean)
}

/** First free port at or above `start`, sliding upward. */
export async function pickPort(start) {
  let port = Number(start)
  while (await portInUse(port)) port++
  return port
}

/**
 * Spawn a workspace tool through pnpm.
 *
 * On Windows pnpm is a .cmd shim, and since the fix for CVE-2024-27980 Node
 * refuses to spawn .cmd files without a shell. Passing an args array together
 * with `shell: true` additionally triggers DEP0190, because the shell would
 * receive them unescaped — so on Windows the command is assembled here and
 * spawned with no separate args.
 *
 * That is safe for these call sites specifically: every argument is either a
 * string literal in this repo or a port number stringified from an integer, so
 * none can contain a space or a shell metacharacter. `cwd` — the one value
 * that can contain spaces — stays an option and is never interpolated. Do not
 * pass user input or file paths through here without quoting them.
 */
export function pnpmExec(args, { cwd, env } = {}) {
  const options = {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  }

  const child = isWindows
    ? spawn(['pnpm.cmd', 'exec', ...args].join(' '), [], {
        ...options,
        shell: true,
      })
    : spawn('pnpm', ['exec', ...args], options)

  track(child)
  return child
}

/** Spawn `node <script>` and resolve when it exits successfully. */
export function nodeScript(script, args, { cwd, env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    track(child)
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${script} exited with ${code}`)),
    )
  })
}

/**
 * Poll `url` until it answers, or throw after `timeoutMs`.
 *
 * Replaces `until curl -sf -o /dev/null ...; do sleep 0.3; done`. As with the
 * original, probe via `localhost` rather than 127.0.0.1 — vite may bind only
 * ::1, and localhost resolves both address families.
 */
export async function waitForHttp(url, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${url}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

// ─── teardown ──────────────────────────────────────────────────────────────
//
// `trap 'kill 0' EXIT` killed the whole process group. Node has no portable
// equivalent, so track children and tear them down explicitly.

const children = new Set()

function track(child) {
  children.add(child)
  child.on('exit', () => children.delete(child))
}

/**
 * Kill a child and everything it spawned.
 *
 * child.kill() only signals the direct child. That is enough on POSIX when
 * the child is the process itself, but on Windows `pnpm exec` sits between us
 * and the real process, so killing the shim would orphan vite/tsx/electron.
 * taskkill /T walks the tree.
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (isWindows) {
    // spawnSync, not spawn: this also runs from the 'exit' handler, where the
    // event loop is already closing and an async spawn would never fire.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    })
  } else {
    child.kill('SIGTERM')
  }
}

let shuttingDown = false

/** Install teardown handlers so closing the app stops everything. */
export function teardownOnExit() {
  const shutdown = (code) => {
    if (shuttingDown) return
    shuttingDown = true
    for (const child of children) killTree(child)
    process.exit(code ?? 0)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  process.on('exit', () => {
    for (const child of children) killTree(child)
  })

  return shutdown
}
