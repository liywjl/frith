// Bare smoke run: `pnpm --filter mobile smoke:bare`. The same scenario as
// smoke.ts, but bundled with the production shims (noble AES-GCM, bare-fs,
// bare-path) and executed by the actual Bare runtime — what ships on the
// phone, minus the phone.
import fs from 'node:fs'; // → bare-fs via the bundle alias
import path from 'node:path'; // → bare-path
import { runSmoke, runSeededSmoke } from './smoke-core.js';

process.env.NODE_ENV = 'test';
process.env.FRITH_MODE = 'production';

const dir = path.join('/tmp', `frith-bare-smoke-${Date.now().toString(36)}`);
fs.mkdirSync(dir, { recursive: true });

try {
  await runSmoke(path.join(dir, 'plain'));
  await runSeededSmoke(path.join(dir, 'seeded'));
  console.log('smoke (bare): all assertions passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
