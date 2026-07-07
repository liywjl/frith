import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, fileKey, isEncrypted, resolveMasterKey } from '../src/space/keys.js';

const scratch = path.join(os.tmpdir(), `frith-keys-${process.pid}`);
const master = Buffer.from('cd'.repeat(32), 'hex');
const savedEnv = process.env.FRITH_MASTER_KEY;

afterEach(() => {
  process.env.FRITH_MASTER_KEY = savedEnv;
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('key custody', () => {
  it('round-trips JSON through FRITH1 envelopes', () => {
    const key = fileKey(master);
    const value = { spaces: [{ name: 'acme', invite: 'deadbeef' }] };
    const bytes = encryptJson(key, value);
    expect(isEncrypted(bytes)).toBe(true);
    expect(bytes.includes('acme')).toBe(false); // no plaintext leakage
    expect(decryptJson(key, bytes)).toEqual(value);
  });

  it('rejects tampered ciphertext', () => {
    const key = fileKey(master);
    const bytes = encryptJson(key, { secret: true });
    bytes[10] = bytes[10]! ^ 0xff;
    expect(() => decryptJson(key, bytes)).toThrow();
  });

  it('rejects the wrong key', () => {
    const bytes = encryptJson(fileKey(master), { secret: true });
    expect(() => decryptJson(fileKey(Buffer.from('ef'.repeat(32), 'hex')), bytes)).toThrow();
  });

  it('recognizes legacy plaintext as not encrypted', () => {
    expect(isEncrypted(Buffer.from('{"active":"local"}'))).toBe(false);
  });

  it('takes the master key from the env when set', () => {
    process.env.FRITH_MASTER_KEY = 'ab'.repeat(32);
    expect(resolveMasterKey(scratch).toString('hex')).toBe('ab'.repeat(32));
    expect(fs.existsSync(path.join(scratch, 'master.key'))).toBe(false);
  });

  it('rejects a malformed env key', () => {
    process.env.FRITH_MASTER_KEY = 'not-hex';
    expect(() => resolveMasterKey(scratch)).toThrow(/64 hex/);
  });

  it('mints a 0600 key file when no env key is set, and reuses it', () => {
    delete process.env.FRITH_MASTER_KEY;
    const first = resolveMasterKey(scratch);
    const file = path.join(scratch, 'master.key');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(resolveMasterKey(scratch).equals(first)).toBe(true);
  });
});
