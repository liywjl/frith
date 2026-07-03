import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto, MeDto, MessageDto, ServerEvent, SpaceDto, UserDto } from '@app/shared';
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
import { CreateChannelModal } from './CreateChannelModal';
import { HomeView } from './HomeView';
import { ProfileView } from './ProfileView';
import { TaskView } from './TaskView';
import { SpaceModal } from './SpaceModal';
import { UserActionsContext, type UserActions } from './userActions';

type View = { kind: 'home' } | { kind: 'task' } | { kind: 'channel' } | { kind: 'profile'; userId: string };

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
  const [view, setView] = useState<View>({ kind: 'home' });
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [threadRoot, setThreadRoot] = useState<MessageDto | null>(null);
  const [homeTick, setHomeTick] = useState(0);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [space, setSpace] = useState<SpaceDto | null>(null);

  useEffect(() => {
    api.space().then(setSpace).catch(console.error);
  }, []);

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
  }, [activeId]);

  const closeOverlays = useCallback(() => {
    setSwitcherOpen(false);
    setAskOpen(false);
    setGroupOpen(false);
    setCreateChannelOpen(false);
  }, []);

  const openChannel = useCallback(
    (id: string) => {
      closeOverlays();
      setView({ kind: 'channel' });
      setActiveId(id);
      void api.markRead(id);
      setChannels((cur) => cur.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    },
    [closeOverlays],
  );

  const openHome = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setHomeTick((t) => t + 1);
    setView({ kind: 'home' });
  }, [closeOverlays]);

  const openTask = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setView({ kind: 'task' });
  }, [closeOverlays]);

  const openProfile = useCallback(
    (userId: string) => {
      closeOverlays();
      setThreadRoot(null);
      setView({ kind: 'profile', userId });
    },
    [closeOverlays],
  );

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
      if (event.type === 'channels.changed') {
        void api.channels().then(setChannels);
        return;
      }
      if (event.type === 'p2p.peers') {
        setSpace((cur) => (cur ? { ...cur, connectedPeers: event.count } : cur));
        return;
      }
      if (event.type === 'reaction.changed') {
        if (event.channelId === activeId) {
          setMessages((cur) => applyReaction(cur, event, me.id));
        }
        return;
      }
      const msg = event.message;
      if (me.blockedUserIds.includes(msg.authorId)) return; // blocked: no feed, no badge
      const viewingThatChannel = view.kind === 'channel' && msg.channelId === activeId;
      if (msg.channelId === activeId) {
        // Keep the cached feed fresh even when Home or a profile is on screen.
        if (msg.parentMessageId === null) {
          setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
        } else {
          setMessages((cur) =>
            cur.map((m) => (m.id === msg.parentMessageId ? { ...m, replyCount: m.replyCount + 1 } : m)),
          );
        }
      }
      if (msg.authorId !== me.id) {
        if (viewingThatChannel) {
          void api.markRead(msg.channelId);
        } else {
          setChannels((cur) => {
            if (!cur.some((c) => c.id === msg.channelId)) {
              // A channel we don't know yet (e.g. someone opened a DM with us).
              void api.channels().then(setChannels);
              return cur;
            }
            return cur.map((c) => (c.id === msg.channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c));
          });
        }
        if (view.kind === 'home') setHomeTick((t) => t + 1);
      }
    },
    [activeId, me.id, me.blockedUserIds, view],
  );
  useRealtime(onEvent);

  const toggleBlock = useCallback(
    async (userId: string, blocked: boolean) => {
      const { blockedUserIds } = await api.setBlocked(userId, blocked);
      onMeChange({ ...me, blockedUserIds });
      if (view.kind === 'channel' && activeId) {
        setMessages(await api.messages(activeId));
      }
    },
    [me, onMeChange, view.kind, activeId],
  );

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

  const onChannelCreated = useCallback(
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
        else if (profileEditOpen) setProfileEditOpen(false);
        else if (groupOpen) setGroupOpen(false);
        else if (createChannelOpen) setCreateChannelOpen(false);
        else setThreadRoot(null);
      } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const cycle = channels.filter((c) => !c.archivedAt);
        if (cycle.length === 0) return;
        const idx = cycle.findIndex((c) => c.id === activeId);
        const next = cycle[(Math.max(idx, 0) + (e.key === 'ArrowDown' ? 1 : cycle.length - 1)) % cycle.length];
        if (next) openChannel(next.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channels, activeId, openChannel, switcherOpen, askOpen, profileEditOpen, groupOpen, createChannelOpen]);

  const active = channels.find((c) => c.id === activeId) ?? null;

  const userActions: UserActions = {
    openDm: (userId) => void openDm(userId),
    openProfile,
    getUser: (userId) => users.find((u) => u.id === userId),
    isOnline: (userId) => online.has(userId),
  };

  return (
    <UserActionsContext.Provider value={userActions}>
    <div className="app">
      <Sidebar
        me={me}
        channels={channels}
        users={users}
        online={online}
        activeId={view.kind === 'channel' ? activeId : null}
        homeActive={view.kind === 'home'}
        taskActive={view.kind === 'task'}
        space={space}
        onHome={openHome}
        onTask={openTask}
        onOpenSpace={() => setSpaceOpen(true)}
        onSelect={openChannel}
        onNewGroup={() => setGroupOpen(true)}
        onNewChannel={() => setCreateChannelOpen(true)}
      />
      {view.kind === 'task' && <TaskView onOpenChannel={openChannel} onOpenThread={openThread} />}
      {view.kind === 'home' && (
        <HomeView
          me={me}
          refreshTick={homeTick}
          onOpenChannel={openChannel}
          onOpenThread={openThread}
          onOpenAsk={() => setAskOpen(true)}
          onStartGroup={(userIds) => void api.createGroup(userIds).then(({ channelId }) => onGroupCreated(channelId))}
        />
      )}
      {view.kind === 'profile' && (
        <ProfileView
          userId={view.userId}
          me={me}
          online={online}
          onOpenDm={openDm}
          onOpenChannel={openChannel}
          onEditProfile={() => setProfileEditOpen(true)}
          onToggleBlock={(userId, blocked) => void toggleBlock(userId, blocked)}
        />
      )}
      {view.kind === 'channel' && active && (
        <ChannelView
          channel={active}
          messages={messages}
          onOpenThread={setThreadRoot}
          onOpenAsk={() => setAskOpen(true)}
        />
      )}
      {view.kind === 'channel' && threadRoot && active && (
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
      {profileEditOpen && <ProfileModal me={me} onSaved={onMeChange} onClose={() => setProfileEditOpen(false)} />}
      {groupOpen && (
        <GroupModal me={me} users={users} onCreated={onGroupCreated} onClose={() => setGroupOpen(false)} />
      )}
      {createChannelOpen && (
        <CreateChannelModal onCreated={onChannelCreated} onClose={() => setCreateChannelOpen(false)} />
      )}
      {spaceOpen && (
        <SpaceModal space={space} onSpaceChange={setSpace} onClose={() => setSpaceOpen(false)} />
      )}
    </div>
    </UserActionsContext.Provider>
  );
}
