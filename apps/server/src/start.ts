import type { AddressInfo } from 'node:net';
import { buildApp } from './api/routes.js';
import { clearExpiredStatuses } from './domain/store.js';
import { publish } from './api/realtime.js';
import { deliverDueScheduled } from './domain/scheduler.js';

/** Build the app, listen on 127.0.0.1 (0 = any free port), start the timers. */
export async function startServer(port: number): Promise<number> {
  const app = await buildApp(); // opens the space (Autobase log) on first call
  await app.listen({ port, host: '127.0.0.1' });

  // Status timers: sweep expired statuses and tell connected clients.
  setInterval(() => {
    void clearExpiredStatuses().then((cleared) => {
      for (const user of cleared) publish({ type: 'user.updated', user }, 'all');
    });
  }, 30_000);

  // Schedule-send: deliver due messages.
  setInterval(() => void deliverDueScheduled(), 15_000);

  return (app.server.address() as AddressInfo).port;
}
