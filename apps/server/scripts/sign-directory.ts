// Curator tool: sign a directory feed so consumers configured with your
// public key (FRITH_DIRECTORY_CURATOR_KEY) accept its entries — and reject
// anything a compromised host slips in alongside them (HARDENING §7).
//
//   tsx scripts/sign-directory.ts feed.json               # mint a keypair, sign, print both
//   tsx scripts/sign-directory.ts feed.json <seed-hex>    # sign with your existing 32-byte seed
//
// Writes the signed feed to stdout; keep the seed offline.
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import { directoryEntryMessage } from '../src/domain/directory.js';

const [file, seedHex] = process.argv.slice(2);
if (!file || (seedHex && !/^[0-9a-f]{64}$/.test(seedHex))) {
  console.error('usage: tsx scripts/sign-directory.ts <feed.json> [seed-hex (64 hex chars)]');
  process.exit(1);
}

const seed = seedHex ? (b4a.from(seedHex, 'hex') as Buffer) : crypto.randomBytes(32);
const pair = hypercoreCrypto.keyPair(seed);

const feed = JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, unknown>[] };
const signed = feed.entries.map((entry) => {
  const { sig: _old, ...fields } = entry;
  const e = {
    name: String(fields.name),
    description: String(fields.description ?? ''),
    tags: (fields.tags ?? []) as string[],
    members: fields.members as number | undefined,
    host: fields.host as string | undefined,
    invite: (fields.invite ?? null) as string | null,
  };
  const sig = b4a.toString(hypercoreCrypto.sign(b4a.from(directoryEntryMessage(e)), pair.secretKey), 'hex');
  return { ...fields, sig };
});

console.log(JSON.stringify({ entries: signed }, null, 2));
console.error(`\ncurator public key (give to consumers as FRITH_DIRECTORY_CURATOR_KEY):`);
console.error(b4a.toString(pair.publicKey, 'hex'));
if (!seedHex) {
  console.error(`curator seed (keep offline, reuse to re-sign):`);
  console.error(b4a.toString(seed, 'hex'));
}
