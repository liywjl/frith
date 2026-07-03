import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const scratch = path.join(os.tmpdir(), `lore-test-${process.pid}`);

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LORE_DATA: path.join(scratch, 'space'),
      LORE_FILES: path.join(scratch, 'files'),
    },
  },
});
