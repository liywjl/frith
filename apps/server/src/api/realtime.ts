import type { WebSocket } from 'ws';
import type { ServerEvent } from '@app/shared';

const sockets = new Map<WebSocket, string>(); // socket → userId

/** Called when a user's last socket closes (e.g. to drop them from calls). */
let onUserOffline: ((userId: string) => void) | null = null;
export function setOnUserOffline(handler: (userId: string) => void) {
  onUserOffline = handler;
}

/** Users with a live socket to THIS instance — i.e. the people at this device. */
export function onlineUserIds(): string[] {
  return [...new Set(sockets.values())];
}

function broadcastPresence() {
  publish({ type: 'presence.changed', onlineUserIds: onlineUserIds() }, 'all');
}

export function register(socket: WebSocket, userId: string) {
  sockets.set(socket, userId);
  broadcastPresence();
  socket.on('close', () => {
    sockets.delete(socket);
    broadcastPresence();
    if (!onlineUserIds().includes(userId)) onUserOffline?.(userId);
  });
}

/** Send an event to one user's connected sockets only. */
export function sendToUser(userId: string, event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const [socket, id] of sockets) {
    if (id === userId) socket.send(payload);
  }
}

/**
 * Send an event to every connected client allowed to see it.
 * Audience 'all' means every workspace member (public channels); an id list
 * restricts delivery to those users (private channels, DMs) — never broadcast
 * private content wider than its channel membership.
 *
 * `skipRecipient` drops individual recipients even when they're in the audience
 * — used to keep live delivery consistent with reads, which hide messages from
 * authors the recipient has blocked. Without it, a blocked person's messages
 * still arrive live and only disappear on refresh.
 */
export function publish(
  event: ServerEvent,
  audience: 'all' | string[],
  skipRecipient?: (userId: string) => boolean,
) {
  const payload = JSON.stringify(event);
  for (const [socket, userId] of sockets) {
    if (audience !== 'all' && !audience.includes(userId)) continue;
    if (skipRecipient?.(userId)) continue;
    socket.send(payload);
  }
}
