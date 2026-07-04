import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { library } from '../src/domain/library.js';

const scratch = path.join(os.tmpdir(), `lore-library-${process.pid}`);

describe('local library', () => {
  it('indexes a folder and searches land in Ask-shaped local hits', async () => {
    fs.mkdirSync(path.join(scratch, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(scratch, 'docs', 'runbook.md'),
      '# Incident runbook\nWhen the flux capacitor overheats, rotate the pager key.',
    );
    fs.writeFileSync(path.join(scratch, 'notes.txt'), 'flux capacitor maintenance schedule');
    fs.mkdirSync(path.join(scratch, 'node_modules', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(scratch, 'node_modules', 'junk', 'skip.md'), 'flux flux flux');

    const source = await library.addSource(scratch, 'test-notes');
    expect(source.fileCount).toBe(2); // node_modules skipped
    expect(source.commitCount).toBe(0); // not a git repo

    const { ask } = await import('../src/domain/ask.js');
    const res = await ask('nobody', 'flux capacitor');
    expect(res.local.length).toBeGreaterThan(0);
    expect(res.local[0]!.sourceName).toBe('test-notes');
    expect(res.local.some((h) => h.ref.endsWith('runbook.md'))).toBe(true);
    expect(res.local[0]!.snippet).toContain('[[');

    expect(library.removeSource(source.id)).toBe(true);
    const after = await ask('nobody', 'flux capacitor');
    expect(after.local.length).toBe(0);
  });

  it('rejects paths that are not folders', async () => {
    await expect(library.addSource(path.join(scratch, 'nope-not-real'))).rejects.toThrow();
  });
});
