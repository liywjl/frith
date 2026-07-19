// The community directory: public spaces broadcasting what they're about,
// so people can find their crowd. The directory itself is deliberately not
// part of any space — it's a feed this instance fetches from a configurable
// URL (FRITH_DIRECTORY_URL), so anyone can host one: a static JSON file on
// any web host today, a curator-signed Autobase feed later (see DESIGN.md).
// Entries are external data: schema-validated, size-capped, and never
// trusted beyond display plus an invite string the user chooses to use.
//
// Curator signatures (HARDENING §7): when FRITH_DIRECTORY_CURATOR_KEY names
// an ed25519 public key you trust, every entry must carry that curator's
// signature — a compromised or malicious host can then still refuse to serve
// the feed, but can't inject entries (i.e. invite keys) of its own. Unsigned
// or mis-signed entries are rejected, not displayed-with-a-warning: a bogus
// invite is the whole attack, so it never reaches the user.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import type { DirectoryDto } from '@app/shared';

const entrySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  members: z.number().int().min(0).max(1_000_000).optional(),
  host: z.string().trim().max(120).optional(),
  invite: z.string().trim().max(600).nullable().default(null),
  /** Curator's ed25519 signature over directoryEntryMessage(entry). */
  sig: z.string().regex(/^[0-9a-f]{128}$/).optional(),
});
type Entry = z.infer<typeof entrySchema>;

const feedSchema = z.object({ entries: z.array(entrySchema).max(200) });

/** What the curator signs, per entry. The hash covers every displayed field
 *  in a fixed order, so a host can't keep a valid signature while swapping
 *  the invite (or anything else) underneath it. */
export const directoryEntryMessage = (e: Omit<Entry, 'sig'>): string => {
  const canonical = JSON.stringify([e.name, e.description, e.tags, e.members ?? null, e.host ?? null, e.invite]);
  return `frith:dir-entry:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
};

const curatorSigned = (e: Entry, curatorKey: string): boolean => {
  if (!e.sig) return false;
  try {
    return hypercoreCrypto.verify(
      b4a.from(directoryEntryMessage(e)),
      b4a.from(e.sig, 'hex'),
      b4a.from(curatorKey, 'hex'),
    );
  } catch {
    return false; // malformed key/sig — treat like a bad signature
  }
};

/** Enforce the curator policy (if configured) and shed the wire-only `sig`. */
const toDtoEntries = (entries: Entry[]): DirectoryDto['entries'] => {
  const curator = process.env.FRITH_DIRECTORY_CURATOR_KEY?.trim();
  const admitted = curator ? entries.filter((e) => curatorSigned(e, curator)) : entries;
  return admitted.map(({ sig: _sig, ...entry }) => entry);
};

export async function getDirectory(): Promise<DirectoryDto> {
  const url = process.env.FRITH_DIRECTORY_URL;
  if (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`directory responded ${res.status}`);
    return { source: url, entries: toDtoEntries(feedSchema.parse(await res.json()).entries) };
  }
  // No directory configured — the bundled sample keeps the surface real in
  // dev and shows self-hosters the format they'd publish.
  const dir = process.env.FRITH_SEED_DIR ?? fileURLToPath(new URL('../../seed', import.meta.url).href);
  return {
    source: null,
    entries: toDtoEntries(feedSchema.parse(JSON.parse(readFileSync(`${dir}/directory.json`, 'utf8'))).entries),
  };
}
