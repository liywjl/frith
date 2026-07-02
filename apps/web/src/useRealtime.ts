import { useEffect, useRef } from 'react';
import type { ServerEvent } from '@app/shared';

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
      socket.onmessage = (e) => handler.current(JSON.parse(e.data as string) as ServerEvent);
      socket.onclose = () => {
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
