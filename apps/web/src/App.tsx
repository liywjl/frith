import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto, MeDto, MessageDto, ServerEvent, UserDto } from '@app/shared';
import { api } from './api';
import { useRealtime } from './useRealtime';
import { applyReaction } from './updates';
import { Sidebar } from './Sidebar';
import { ChannelView } from './ChannelView';
import { ThreadPanel } from './ThreadPanel';
import { QuickSwitcher } from './QuickSwitcher';
import { AskPanel } from './AskPanel';
import { ProfileModal } from './ProfileModal';
import { GroupModal } from './GroupModal';

export function App() {
  const [me, setMe] = useState<MeDto | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = me?.theme ?? 'paper';
  }, [me?.theme]);

  if (!checked) return null;
  if (!me) return <Login onLogin={() => void api.me().then(setMe)} />;
  return <Workspace me={me} onMeChange={setMe} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
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
            <span className="login-emoji">{u.avatarEmoji ?? '·'}</span>
            {u.name} <span className="handle">@{u.handle}</span>
            <span className="login-title">{[u.title, u.team].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
      {users.length === 0 && <p className="hint">No users — run `pnpm seed` first.</p>}
    </div>
  );
}

function Workspace({ me, onMeChange }: { me: MeDto; onMeChange: (me: MeDto) => void }) {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [threadRoot, setThreadRoot] = useState<MessageDto | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

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
      if (event.type === 'user.updated') {
        setUsers((cur) => cur.map((u) => (u.id === event.user.id ? event.user : u)));
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
    setGroupOpen(false);
    setActiveId(id);
  }, []);

  const openDm = useCallback(
    async (userId: string) => {
      const { channelId } = await api.openDm(userId);
      setChannels(await api.channels());
      openChannel(channelId);
    },
    [openChannel],
  );

  const onGroupCreated = useCallback(
    async (channelId: string) => {
      setChannels(await api.channels());
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
        else if (profileOpen) setProfileOpen(false);
        else if (groupOpen) setGroupOpen(false);
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
  }, [channels, switcherOpen, askOpen, profileOpen, groupOpen]);

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
        onNewGroup={() => setGroupOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
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
      {profileOpen && <ProfileModal me={me} onSaved={onMeChange} onClose={() => setProfileOpen(false)} />}
      {groupOpen && (
        <GroupModal me={me} users={users} onCreated={onGroupCreated} onClose={() => setGroupOpen(false)} />
      )}
    </div>
  );
}
