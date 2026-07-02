import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto, MessageDto, ServerEvent, UserDto } from '@app/shared';
import { api } from './api';
import { useRealtime } from './useRealtime';
import { applyReaction } from './updates';
import { Sidebar } from './Sidebar';
import { ChannelView } from './ChannelView';
import { ThreadPanel } from './ThreadPanel';
import { QuickSwitcher } from './QuickSwitcher';
import { AskPanel } from './AskPanel';

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
      <h1>Lore</h1>
      <p>Your team's memory. Dev login — pick who you are today.</p>
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
  const [users, setUsers] = useState<UserDto[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [threadRoot, setThreadRoot] = useState<MessageDto | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.channels().then((cs) => {
      if (cancelled) return;
      setChannels(cs);
      setActiveId((cur) => cur ?? cs.find((c) => c.type === 'public')?.id ?? cs[0]?.id ?? null);
    });
    api.users().then((us) => {
      if (!cancelled) setUsers(us);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setThreadRoot(null);
    api.messages(activeId).then(setMessages).catch(console.error);
    void api.markRead(activeId);
    setChannels((cur) => cur.map((c) => (c.id === activeId ? { ...c, unreadCount: 0 } : c)));
  }, [activeId]);

  const onEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === 'presence.changed') {
        setOnline(new Set(event.onlineUserIds));
        return;
      }
      if (event.type === 'reaction.changed') {
        if (event.channelId === activeId) {
          setMessages((cur) => applyReaction(cur, event, me.id));
        }
        return;
      }
      const msg = event.message;
      if (msg.channelId === activeId) {
        if (msg.parentMessageId === null) {
          setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
        } else {
          setMessages((cur) =>
            cur.map((m) => (m.id === msg.parentMessageId ? { ...m, replyCount: m.replyCount + 1 } : m)),
          );
        }
        if (msg.authorId !== me.id) void api.markRead(msg.channelId);
      } else if (msg.authorId !== me.id) {
        setChannels((cur) => {
          if (!cur.some((c) => c.id === msg.channelId)) {
            // A channel we don't know yet (e.g. someone opened a DM with us).
            void api.channels().then(setChannels);
            return cur;
          }
          return cur.map((c) => (c.id === msg.channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c));
        });
      }
    },
    [activeId, me.id],
  );
  useRealtime(onEvent);

  const openChannel = useCallback((id: string) => {
    setSwitcherOpen(false);
    setAskOpen(false);
    setActiveId(id);
  }, []);

  const openDm = useCallback(
    async (userId: string) => {
      const { channelId } = await api.openDm(userId);
      const cs = await api.channels();
      setChannels(cs);
      openChannel(channelId);
    },
    [openChannel],
  );

  const openThread = useCallback(
    async (rootId: string, channelId: string) => {
      openChannel(channelId);
      const thread = await api.thread(rootId);
      const root = thread[0];
      if (root) setThreadRoot(root);
    },
    [openChannel],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAskOpen(false);
        setSwitcherOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setSwitcherOpen(false);
        setAskOpen((v) => !v);
      } else if (e.key === 'Escape') {
        if (switcherOpen) setSwitcherOpen(false);
        else if (askOpen) setAskOpen(false);
        else setThreadRoot(null);
      } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setActiveId((cur) => {
          const idx = channels.findIndex((c) => c.id === cur);
          const next = channels[(idx + (e.key === 'ArrowDown' ? 1 : channels.length - 1)) % channels.length];
          return next?.id ?? cur;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channels, switcherOpen, askOpen]);

  const active = channels.find((c) => c.id === activeId) ?? null;

  return (
    <div className="app">
      <Sidebar
        me={me}
        channels={channels}
        users={users}
        online={online}
        activeId={activeId}
        onSelect={openChannel}
        onOpenDm={openDm}
      />
      {active && (
        <ChannelView
          channel={active}
          messages={messages}
          onOpenThread={setThreadRoot}
          onOpenAsk={() => setAskOpen(true)}
        />
      )}
      {threadRoot && active && (
        <ThreadPanel me={me} channel={active} root={threadRoot} onClose={() => setThreadRoot(null)} />
      )}
      {switcherOpen && (
        <QuickSwitcher
          me={me}
          channels={channels}
          users={users}
          online={online}
          onSelectChannel={openChannel}
          onSelectUser={openDm}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
      {askOpen && (
        <AskPanel onClose={() => setAskOpen(false)} onOpenChannel={openChannel} onOpenThread={openThread} />
      )}
    </div>
  );
}
