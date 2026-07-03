import { buildApp } from './app.js';
import { clearExpiredStatuses } from './store.js';
import { publish } from './realtime.js';
import { startBridge } from './p2p/bridge.js';

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });

// P2P workspace bridge: set LORE_P2P_ROOM on two instances and their public
// channels sync peer-to-peer (see scripts/dev-peer.sh for a second instance).
if (process.env.LORE_P2P_ROOM) {
  await startBridge(process.env.LORE_P2P_ROOM, process.env.LORE_P2P_DATA ?? '.lore-p2p');
}

// Status timers: sweep expired statuses and tell connected clients.
setInterval(() => {
  void clearExpiredStatuses().then((cleared) => {
    for (const user of cleared) publish({ type: 'user.updated', user }, 'all');
  });
}, 30_000);
