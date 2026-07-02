import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto, MessageDto, ServerEvent, UserDto } from '@app/shared';
import { api } from './api';
import { useRealtime } from './useRealtime';
import { Sidebar } from './Sidebar';
import { ChannelView } from './ChannelView';
import { ThreadPanel } from './ThreadPanel';

export function App() {
  const [me, setMe] = useState<UserDto | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;
  if (!me) return <Login onLogin={setMe} />;
  return <Workspace me={me} />;
}

function Login({ onLogin }: { onLogin: (user: UserDto) => void }) {
  const [users, setUsers] = useState<UserDto[]>([]);
  useEffect(() => {
    api.users().then(setUsers).catch(console.error);
  }, []);

  return (
    <div className="login">
      <h1>Acme</h1>
      <p>Dev login — pick who you are today.</p>
      <div className="login-list">
        {users.map((u) => (
          <button key={u.id} onClick={() => api.login(u.handle).then(onLogin)}>
            {u.name} <span className="handle">@{u.handle}</span>
          </button>
        ))}
      </div>
      {users.length === 0 && <p className="hint">No users — run `pnpm seed` first.</p>}
    </div>
  );
}

function Workspace({ me }: { me: UserDto }) {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [threadRoot, setThreadRoot] = useState<MessageDto | null>(null);

  useEffect(() => {
    api.channels().then((cs) => {
      setChannels(cs);
      setActiveId((cur) => cur ?? cs.find((c) => c.type === 'public')?.id ?? cs[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setThreadRoot(null);
    api.messages(activeId).then(setMessages).catch(console.error);
  }, [activeId]);

  const onEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type !== 'message.created') return;
      const msg = event.message;
      if (msg.channelId !== activeId) return;
      if (msg.parentMessageId === null) {
        setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
      } else {
        setMessages((cur) =>
          cur.map((m) => (m.id === msg.parentMessageId ? { ...m, replyCount: m.replyCount + 1 } : m)),
        );
      }
    },
    [activeId],
  );
  useRealtime(onEvent);

  const active = channels.find((c) => c.id === activeId) ?? null;

  return (
    <div className="app">
      <Sidebar me={me} channels={channels} activeId={activeId} onSelect={setActiveId} />
      {active && (
        <ChannelView
          channel={active}
          messages={messages}
          onOpenThread={setThreadRoot}
        />
      )}
      {threadRoot && active && (
        <ThreadPanel channel={active} root={threadRoot} onClose={() => setThreadRoot(null)} />
      )}
    </div>
  );
}
