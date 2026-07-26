// Fingerprint verification (HARDENING §6): two members compare a short code
// out of band (in person, over a call) and mark each other verified. The code
// is derived from both users' root identity keys, order-independent, so both
// sides read the same digits; a MITM'd or swapped root changes the code.
//
// The verified mark is deliberately device-local — it records YOUR judgment,
// not a fact of the space, so it never touches the log. The mark stores the
// code it vouched for: if a contact's root key ever changes, the stored code
// no longer matches and the contact silently drops back to unverified.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { space } from '../space/space.js';

const file = () => path.join(process.env.FRITH_DATA ?? '.frith-data', 'verified-contacts.json');
type Marks = Record<string, string>; // `${viewerId}:${otherId}` → code at verification time

const load = (): Marks => {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as Marks;
  } catch {
    return {}; // fresh device — nothing verified yet
  }
};
const save = (marks: Marks): void => {
  try {
    // Who you have verified is device-local judgment about other people —
    // owner-only on disk, like the registry.
    fs.writeFileSync(file(), JSON.stringify(marks), { mode: 0o600 });
  } catch {
    // best-effort — worst case the user re-verifies
  }
};

/** 40 digits in 8 spoken-size groups, from a hash over both roots. Null when
 *  either side has no root identity (dev-seeded demo users don't). */
export function fingerprintCode(userA: string, userB: string): string | null {
  const rootA = space.state.roots.get(userA);
  const rootB = space.state.roots.get(userB);
  if (!rootA || !rootB || userA === userB) return null;
  const digest = crypto
    .createHash('sha256')
    .update(`frith:fingerprint:${[rootA, rootB].sort().join(':')}`)
    .digest('hex');
  const digits = (BigInt(`0x${digest}`) % 10n ** 40n).toString().padStart(40, '0');
  return digits.match(/.{5}/g)!.join(' ');
}

export function fingerprintFor(viewerId: string, otherId: string): { code: string | null; verified: boolean } {
  const code = fingerprintCode(viewerId, otherId);
  return { code, verified: code !== null && load()[`${viewerId}:${otherId}`] === code };
}

export function setContactVerified(
  viewerId: string,
  otherId: string,
  on: boolean,
): { code: string | null; verified: boolean } {
  const code = fingerprintCode(viewerId, otherId);
  const marks = load();
  const key = `${viewerId}:${otherId}`;
  if (on && code) marks[key] = code;
  else delete marks[key];
  save(marks);
  return { code, verified: on && code !== null };
}
