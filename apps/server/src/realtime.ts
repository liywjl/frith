import type { WebSocket } from 'ws';
import type { ServerEvent } from '@app/shared';

const sockets = new Map<WebSocket, string>(); // socket → userId

export function register(socket: WebSocket, userId: string) {
  sockets.set(socket, userId);
  socket.on('close', () => sockets.delete(socket));
}

/**
 * Send an event to every connected client allowed to see it.
 * Audience 'all' means every workspace member (public channels); an id list
 * restricts delivery to those users (private channels, DMs) — never broadcast
 * private content wider than its channel membership.
 */
export function publish(event: ServerEvent, audience: 'all' | string[]) {
  const payload = JSON.stringify(event);
  for (const [socket, userId] of sockets) {
    if (audience === 'all' || audience.includes(userId)) {
      socket.send(payload);
    }
  }
}
