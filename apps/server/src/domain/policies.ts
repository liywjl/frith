// Storage policies are a property of THIS DEVICE, not of the space — they
// never enter the log. What you're willing to store and auto-download is
// yours to decide; the defaults keep a laptop safe in a busy space.
import fs from 'node:fs';
import path from 'node:path';
import type { PoliciesDto } from '@app/shared';

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
  return path.join(process.env.LORE_DATA ?? '.lore-data', 'policies.json');
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
  fs.writeFileSync(policiesFile(), JSON.stringify(current, null, 2));
  return current;
}

export const mb = (n: number): number => n * 1024 * 1024;
