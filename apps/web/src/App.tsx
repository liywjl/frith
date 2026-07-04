import { useCallback, useEffect, useRef, useState } from 'react';
import {
  THEMES,
  type ChannelDto,
  type MeDto,
  type MessageDto,
  type ScheduledMessageDto,
  type ServerEvent,
  type SpaceDto,
  type Theme,
  type UserDto,
} from '@app/shared';
import { api } from './lib/api';
import { useRealtime } from './lib/useRealtime';
import { applyReaction } from './lib/updates';
import { Sidebar } from './components/Sidebar';
import { ChannelView } from './views/ChannelView';
import { ThreadPanel } from './panels/ThreadPanel';
import { QuickSwitcher } from './modals/QuickSwitcher';
import { AskPanel } from './panels/AskPanel';
import { ProfileModal } from './modals/ProfileModal';
import { GroupModal } from './modals/GroupModal';
import { CreateChannelModal } from './modals/CreateChannelModal';
import { HomeView } from './views/HomeView';
import { ProfileView } from './views/ProfileView';
import { TaskView } from './views/TaskView';
import { SpaceModal } from './modals/SpaceModal';
import { StorageModal } from './modals/StorageModal';
import { LibraryModal } from './modals/LibraryModal';
import { ProfilePanel } from './panels/ProfilePanel';
import { CallPanel } from './panels/CallPanel';
import { CallManager } from './lib/call';
import type { SlashCommand } from './components/Composer';
import { Logo } from './components/Logo';
import { PeopleView } from './views/PeopleView';
import { TagModal } from './modals/TagModal';
import { UserActionsContext, type UserActions } from './lib/userActions';

type View =
  | { kind: 'home' }
  | { kind: 'task' }
  | { kind: 'people' }
  | { kind: 'channel' }
  | { kind: 'profile'; userId: string };

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
      <h1 className="login-brand">
        <Logo size={40} /> Lore
      </h1>
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
  const [storageOpen, setStorageOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [openedTag, setOpenedTag] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledMessageDto[]>([]);

  // Campfires (calls)
  const [calls, setCalls] = useState<Record<string, string[]>>({});
  const [myCall, setMyCall] = useState<{ channelId: string; withVideo: boolean } | null>(null);
  const [callStreams, setCallStreams] = useState<Map<string, MediaStream>>(new Map());
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(true);
  const callManager = useRef<CallManager | null>(null);

  useEffect(() => {
    api.space().then(setSpace).catch(console.error);
    api.calls().then(setCalls).catch(console.error);
    api.scheduled().then(setScheduled).catch(console.error);
  }, []);

  const startCall = useCallback(async (channelId: string, withVideo: boolean) => {
    if (callManager.current) return; // one campfire at a time
    const { participants } = await api.joinCall(channelId);
    const manager = new CallManager(setCallStreams);
    callManager.current = manager;
    setMuted(false);
    setVideoOn(withVideo);
    setMyCall({ channelId, withVideo });
    await manager.join(channelId, withVideo, participants);
  }, []);

  const leaveCall = useCallback(() => {
    if (!myCall) return;
    void api.leaveCall(myCall.channelId);
    callManager.current?.leave();
    callManager.current = null;
    setMyCall(null);
    setCallStreams(new Map());
  }, [myCall]);

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

  const openPeople = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setView({ kind: 'people' });
  }, [closeOverlays]);

  const togglePin = useCallback(async (channelId: string, pinned: boolean) => {
    await api.setPinned(channelId, pinned);
    setChannels(await api.channels());
  }, []);

  const reorderPins = useCallback(async (channelIds: string[]) => {
    // Optimistic: reflect the new order immediately.
    setChannels((cur) =>
      cur.map((c) => (channelIds.includes(c.id) ? { ...c, pinned: channelIds.indexOf(c.id) } : c)),
    );
    await api.reorderPins(channelIds);
  }, []);

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
      if (event.type === 'call.changed') {
        setCalls((cur) => ({ ...cur, [event.channelId]: event.participants }));
        if (myCall?.channelId === event.channelId) {
          callManager.current?.prune(event.participants);
        }
        return;
      }
      if (event.type === 'rtc.signal') {
        void callManager.current?.handleSignal(event.from, event.payload);
        return;
      }
      if (event.type === 'reaction.changed') {
        if (event.channelId === activeId) {
          setMessages((cur) => applyReaction(cur, event, me.id));
        }
        return;
      }
      if (event.type === 'file.cached') {
        // Bytes arrived from a peer — flip the fetch chip into real media.
        if (event.channelId === activeId) {
          setMessages((cur) =>
            cur.map((m) =>
              m.id === event.messageId
                ? { ...m, attachments: m.attachments.map((a) => (a.id === event.attachmentId ? { ...a, cached: true } : a)) }
                : m,
            ),
          );
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
    [activeId, me.id, me.blockedUserIds, view, myCall],
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

  const slashCommands: SlashCommand[] = [
    { name: 'campfire', hint: 'Start a voice campfire here', run: () => active && void startCall(active.id, false) },
    { name: 'video', hint: 'Start a video campfire here', run: () => active && void startCall(active.id, true) },
    {
      name: 'schedule',
      hint: '/schedule 30m|2h message — send it later',
      run: (arg) => {
        const match = /^(\d+)\s*([mh])\s+(.+)$/.exec(arg);
        if (!match || !active) return;
        const minutes = Number(match[1]) * (match[2] === 'h' ? 60 : 1);
        void api.schedule(active.id, match[3]!, minutes).then((s) => setScheduled((cur) => [...cur, s]));
      },
    },
    {
      name: 'status',
      hint: '/status ☕ deep work — set your status',
      run: (arg) => {
        const [emoji, ...rest] = arg.split(/\s+/);
        void api
          .patchMe({ statusEmoji: emoji || null, statusText: rest.join(' ') || null })
          .then((u) => onMeChange({ ...me, ...u }));
      },
    },
    {
      name: 'theme',
      hint: `/theme ${THEMES.join('|')}`,
      run: (arg) => {
        if ((THEMES as readonly string[]).includes(arg.trim())) {
          const theme = arg.trim() as Theme;
          void api.patchMe({ theme }).then(() => onMeChange({ ...me, theme }));
        }
      },
    },
    { name: 'task', hint: 'Scope a task', run: () => openTask() },
    { name: 'home', hint: 'Back to your digest', run: () => openHome() },
    { name: 'storage', hint: 'What this device stores & auto-downloads', run: () => setStorageOpen(true) },
    { name: 'library', hint: 'Local folders & repos Ask can cite', run: () => setLibraryOpen(true) },
    {
      name: 'archive',
      hint: 'Archive this channel (stays searchable)',
      run: () => active && active.type !== 'dm' && void api.setArchived(active.id, true),
    },
  ];

  const userActions: UserActions = {
    openDm: (userId) => void openDm(userId),
    openProfile,
    openTag: setOpenedTag,
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
        peopleActive={view.kind === 'people'}
        space={space}
        liveCalls={new Set(Object.keys(calls).filter((id) => (calls[id] ?? []).length > 0))}
        onHome={openHome}
        onTask={openTask}
        onPeople={openPeople}
        onOpenSpace={() => setSpaceOpen(true)}
        onSelect={openChannel}
        onNewGroup={() => setGroupOpen(true)}
        onNewChannel={() => setCreateChannelOpen(true)}
        onTogglePin={(id, pinned) => void togglePin(id, pinned)}
        onReorderPins={(ids) => void reorderPins(ids)}
      />
      {view.kind === 'people' && (
        <PeopleView
          me={me}
          users={users}
          online={online}
          space={space}
          onToggleBlock={(userId, blocked) => void toggleBlock(userId, blocked)}
        />
      )}
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
          onMeChange={onMeChange}
        />
      )}
      {view.kind === 'channel' && active && (
        <ChannelView
          channel={active}
          messages={messages}
          callParticipants={calls[active.id] ?? []}
          inCall={myCall?.channelId === active.id}
          onStartCall={(withVideo) => void startCall(active.id, withVideo)}
          commands={slashCommands}
          scheduled={scheduled.filter((s) => s.channelId === active.id)}
          onCancelScheduled={(id) =>
            void api.cancelScheduled(id).then(() => setScheduled((cur) => cur.filter((s) => s.id !== id)))
          }
          onOpenThread={setThreadRoot}
          onOpenAsk={() => setAskOpen(true)}
        />
      )}
      {view.kind === 'channel' && threadRoot && active && (
        <ThreadPanel me={me} channel={active} root={threadRoot} onClose={() => setThreadRoot(null)} />
      )}
      {view.kind === 'channel' &&
        !threadRoot &&
        active?.type === 'dm' &&
        (active.dmPartnerIds ?? []).length === 1 && (
          <ProfilePanel
            userId={active.dmPartnerIds![0]!}
            channels={channels}
            online={online}
            onOpenChannel={openChannel}
          />
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
      {storageOpen && <StorageModal onClose={() => setStorageOpen(false)} />}
      {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} />}
      {openedTag && <TagModal tag={openedTag} users={users} meId={me.id} onClose={() => setOpenedTag(null)} />}
      {myCall && (
        <CallPanel
          channelLabel={(() => {
            const c = channels.find((ch) => ch.id === myCall.channelId);
            return c ? (c.type === 'dm' ? (c.dmPartnerNames ?? []).join(', ') : `# ${c.name}`) : 'campfire';
          })()}
          meId={me.id}
          meName={me.name}
          meEmoji={me.avatarEmoji}
          participants={calls[myCall.channelId] ?? [me.id]}
          streams={callStreams}
          localStream={callManager.current?.local ?? null}
          muted={muted}
          videoOn={videoOn}
          onToggleMute={() => {
            callManager.current?.setMuted(!muted);
            setMuted(!muted);
          }}
          onToggleVideo={() => {
            if (videoOn) {
              callManager.current?.setVideoEnabled(false);
              setVideoOn(false);
            } else {
              void callManager.current?.enableCamera().then((ok) => ok && setVideoOn(true));
            }
          }}
          onLeave={leaveCall}
        />
      )}
    </div>
    </UserActionsContext.Provider>
  );
}
