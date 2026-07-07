import { useEffect, useRef } from 'react';
import type { ClientEvent, ServerEvent } from '@app/shared';

// Every mounted useRealtime keeps its own socket; sends go out over any open
// one. A single "latest socket" pointer breaks the moment a panel unmounts —
// closing a thread panel must not kill call signaling.
const liveSockets = new Set<WebSocket>();

/** Send a client event (e.g. WebRTC signaling) over any live socket. */
export function sendClientEvent(event: ClientEvent) {
  for (const socket of liveSockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
      return;
    }
  }
}

/** Subscribe to server events for as long as the component is mounted. */
export function useRealtime(onEvent: (event: ServerEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let socket: WebSocket;
    let closed = false;

    function connect() {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
      socket.onopen = () => {
        liveSockets.add(socket);
      };
      socket.onmessage = (e) => handler.current(JSON.parse(e.data as string) as ServerEvent);
      socket.onclose = () => {
        liveSockets.delete(socket);
        if (!closed) setTimeout(connect, 2000);
      };
    }
    connect();

    return () => {
      closed = true;
      socket.close();
    };
  }, []);
}
