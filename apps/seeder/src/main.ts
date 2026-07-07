// The seeder: a headless, always-on peer. It joins a space by invite and
// then just replicates — the log to anyone, attachment bytes for everything
// it can fetch — so members sync even when no teammate's laptop is online.
// No API, no UI, no user: it never appends an op of its own.
//
//   pnpm --filter seeder join "frith:acme:abc…"   # once, while a member is online
//   pnpm --filter seeder serve                   # forever (systemd, a VPS, a Pi)
import { space, parseInvite } from '../../server/src/space/space.js';

const dataDir = process.env.FRITH_SEED_DATA ?? '.frith-seed';

async function join(invite: string | undefined): Promise<void> {
  const parsed = invite ? parseInvite(invite) : null;
  if (!parsed) {
    console.error('usage: pnpm --filter seeder join "frith:<space>:<hex>"');
    process.exit(1);
  }
  await space.open(dataDir);
  console.log(`[seeder] pairing with "${parsed.name}" — needs a member instance online…`);
  await space.joinSpace(parsed.name, parsed.inviteHex);
  console.log(`[seeder] joined "${parsed.name}" — now run: pnpm --filter seeder serve`);
  await space.close();
}

/** Pull every attachment's bytes so this seeder can serve them all. */
async function fetchBlobs(): Promise<void> {
  for (const att of space.state.attachments.values()) {
    if (!att.blob || (await space.blobs.isCached(att.blob))) continue;
    const bytes = await space.blobs.get(att.blob, { wait: true, expectedHash: att.hash }).catch(() => null);
    if (bytes) console.log(`[seeder] fetched ${att.name} (${att.size} bytes)`);
  }
}

async function run(): Promise<void> {
  await space.open(dataDir);
  console.log(`[seeder] serving "${space.name}" from ${dataDir} — ctrl-c to stop`);
  space.onPeers((count) => console.log(`[seeder] peers: ${count}`));
  space.onOp((op) => {
    if (op.t === 'att') void fetchBlobs();
  });
  await fetchBlobs();
  setInterval(() => {
    const { cachedBytes } = space.blobs.usage();
    console.log(
      `[seeder] peers=${space.connectedPeers()} messages=${space.state.messages.size} blobCache=${cachedBytes}B`,
    );
  }, 60_000).unref?.();
  // Keep the process alive; the swarm does the rest.
  await new Promise(() => {});
}

const cmd = process.argv[2];
if (cmd === 'join') await join(process.argv[3]);
else if (cmd === 'run') await run();
else {
  console.error('usage: main.ts join "<invite>" | run');
  process.exit(1);
}
