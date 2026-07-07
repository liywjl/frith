// Node smoke run: `pnpm --filter mobile smoke`. Exercises the entire worklet
// backend (RPC loop included) against a scratch dir with Node's real crypto —
// the same sources the Bare bundle wraps. NODE_ENV=test keeps it off the DHT.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.FRITH_MODE = 'production';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frith-mobile-smoke-'));
const { runSmoke, runSeededSmoke } = await import('./smoke-core.js');
const { crossCheckCrypto } = await import('./smoke-crypto.js');

let failed = false;
try {
  crossCheckCrypto(); // desktop Node crypto ⇄ mobile shim, byte for byte
  await runSmoke(path.join(dir, 'plain'));
  await runSeededSmoke(path.join(dir, 'seeded'));
} catch (err) {
  console.error(err);
  failed = true;
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
