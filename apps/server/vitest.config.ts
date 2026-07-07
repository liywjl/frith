import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const scratch = path.join(os.tmpdir(), `frith-test-${process.pid}`);

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      FRITH_DATA: path.join(scratch, 'space'),
      FRITH_FILES: path.join(scratch, 'files'),
      // Fixed master key: deterministic custody, no key file minted in CI.
      FRITH_MASTER_KEY: 'ab'.repeat(32),
    },
  },
});
