import { buildApp } from './app.js';
import { clearExpiredStatuses, getSpace, parseInvite } from './store.js';
import { publish } from './realtime.js';
import { startBridge } from './p2p/bridge.js';

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });

// P2P: rejoin the persisted space, or honor LORE_P2P_ROOM for dev setups
// (see scripts/dev-peer.sh for running a second instance).
const dataDir = process.env.LORE_P2P_DATA ?? '.lore-p2p';
const space = await getSpace();
if (space) {
  await startBridge(`space:${parseInvite(space.invite)!.key}`, dataDir);
} else if (process.env.LORE_P2P_ROOM) {
  await startBridge(process.env.LORE_P2P_ROOM, dataDir);
}

// Status timers: sweep expired statuses and tell connected clients.
setInterval(() => {
  void clearExpiredStatuses().then((cleared) => {
    for (const user of cleared) publish({ type: 'user.updated', user }, 'all');
  });
}, 30_000);
