// Storage policies are a property of THIS DEVICE, not of the space — they
// never enter the log. What you're willing to store and auto-download is
// yours to decide; the defaults keep a laptop safe in a busy space.
import fs from 'node:fs';
import path from 'node:path';
import type { PoliciesDto, StorageDto } from '@app/shared';

const DEFAULT_POLICIES: PoliciesDto = {
  /** Uploads bigger than this are rejected outright. */
  maxUploadMB: 100,
  /** Files at or under this size download automatically when they appear. */
  autoFetchMB: 25,
  /** Only auto-download files newer than this many days. */
  autoFetchRecentDays: 90,
  /** Cached files from other peers evict (least recently used) beyond this. */
  storageBudgetMB: 1024,
};

let current: PoliciesDto | null = null;

function policiesFile(): string {
  return path.join(process.env.FRITH_DATA ?? '.frith-data', 'policies.json');
}

export function getPolicies(): PoliciesDto {
  if (current) return current;
  try {
    current = { ...DEFAULT_POLICIES, ...(JSON.parse(fs.readFileSync(policiesFile(), 'utf8')) as PoliciesDto) };
  } catch {
    current = { ...DEFAULT_POLICIES };
  }
  return current;
}

export function setPolicies(patch: Partial<PoliciesDto>): PoliciesDto {
  current = { ...getPolicies(), ...patch };
  fs.mkdirSync(path.dirname(policiesFile()), { recursive: true });
  fs.writeFileSync(policiesFile(), JSON.stringify(current, null, 2), { mode: 0o600 });
  return current;
}

export const mb = (n: number): number => n * 1024 * 1024;

/** Where this device's master key lives. The desktop shell sets this once it
 *  knows whether the OS keychain was usable; everywhere else (headless, dev)
 *  the key is a 0600 file, which is the honest answer. */
const keyCustody = (): StorageDto['keyCustody'] => (process.env.FRITH_KEYCHAIN === 'os' ? 'os' : 'file');

/** The storage DTO both edges answer with — one shape, one place. */
export function storageDto(usage: StorageDto['usage']): StorageDto {
  return { policies: getPolicies(), usage, keyCustody: keyCustody() };
}
