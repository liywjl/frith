// App-wide state: the backend handle, the hello payload (me + space), and a
// live channel list that refetches on realtime events — the same triggers the
// web client hangs off its websocket.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChannelDto } from '@app/shared';
import type { HelloDto } from '../../common/protocol';
import type { Backend } from './backend';

export interface AppStore {
  backend: Backend;
  hello: HelloDto;
  /** Re-pull hello (after profile/space mutations) or replace it directly. */
  refreshHello: (next?: HelloDto) => Promise<void>;
  channels: ChannelDto[];
  refreshChannels: () => Promise<void>;
  peers: number;
}

const Ctx = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside provider');
  return store;
}

export function StoreProvider(props: { backend: Backend; initial: HelloDto; children: ReactNode }) {
  const { backend } = props;
  const [hello, setHello] = useState(props.initial);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [peers, setPeers] = useState(props.initial.space.connectedPeers);

  const refreshHello = useCallback(
    async (next?: HelloDto) => setHello(next ?? (await backend.call<HelloDto>('hello'))),
    [backend],
  );

  const signedIn = hello.me !== null;
  const refreshChannels = useCallback(async () => {
    if (!signedIn) return;
    setChannels(await backend.call<ChannelDto[]>('channels.list'));
  }, [backend, signedIn]);

  useEffect(() => {
    void refreshChannels();
    return backend.onEvent((event) => {
      if (event.type === 'channels.changed' || event.type === 'message.created') void refreshChannels();
      if (event.type === 'p2p.peers') setPeers(event.count);
      if (event.type === 'user.updated') void refreshHello();
    });
  }, [backend, refreshChannels, refreshHello]);

  const store = useMemo<AppStore>(
    () => ({ backend, hello, refreshHello, channels, refreshChannels, peers }),
    [backend, hello, refreshHello, channels, refreshChannels, peers],
  );
  return <Ctx.Provider value={store}>{props.children}</Ctx.Provider>;
}
