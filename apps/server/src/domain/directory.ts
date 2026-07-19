// The community directory: public spaces broadcasting what they're about,
// so people can find their crowd. The directory itself is deliberately not
// part of any space — it's a feed this instance fetches from a configurable
// URL (FRITH_DIRECTORY_URL), so anyone can host one: a static JSON file on
// any web host today, a curator-signed Autobase feed later (see DESIGN.md).
// Entries are external data: schema-validated, size-capped, and never
// trusted beyond display plus an invite string the user chooses to use.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DirectoryDto } from '@app/shared';

const feedSchema = z.object({
  entries: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300).default(''),
        tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
        members: z.number().int().min(0).max(1_000_000).optional(),
        host: z.string().trim().max(120).optional(),
        invite: z.string().trim().max(600).nullable().default(null),
      }),
    )
    .max(200),
});

export async function getDirectory(): Promise<DirectoryDto> {
  const url = process.env.FRITH_DIRECTORY_URL;
  if (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`directory responded ${res.status}`);
    return { source: url, entries: feedSchema.parse(await res.json()).entries };
  }
  // No directory configured — the bundled sample keeps the surface real in
  // dev and shows self-hosters the format they'd publish.
  const dir = process.env.FRITH_SEED_DIR ?? fileURLToPath(new URL('../../seed', import.meta.url).href);
  return { source: null, entries: feedSchema.parse(JSON.parse(readFileSync(`${dir}/directory.json`, 'utf8'))).entries };
}
