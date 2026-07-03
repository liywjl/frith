import { buildApp } from './app.js';
import { clearExpiredStatuses } from './store.js';
import { publish } from './realtime.js';
import { deliverDueScheduled } from './scheduler.js';

const app = await buildApp(); // opens the space (Autobase log) on first call
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });

// Status timers: sweep expired statuses and tell connected clients.
setInterval(() => {
  void clearExpiredStatuses().then((cleared) => {
    for (const user of cleared) publish({ type: 'user.updated', user }, 'all');
  });
}, 30_000);

// Schedule-send: deliver due messages.
setInterval(() => void deliverDueScheduled(), 15_000);
