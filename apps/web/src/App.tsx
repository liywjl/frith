import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  THEMES,
  type DocDto,
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
import { SpaceModal } from './modals/SpaceModal';
import { StorageModal } from './modals/StorageModal';
import { DevicesModal } from './modals/DevicesModal';
import { PaletteModal } from './modals/PaletteModal';
import { ProfilePanel } from './panels/ProfilePanel';
import { CallPanel } from './panels/CallPanel';
import { CallManager } from './lib/call';
import { CallRecorder } from './lib/record';
import type { SlashCommand } from './components/Composer';
import { Avatar } from './components/Avatar';
import { Icon } from './components/Icon';
import { DemoBanner } from './components/DemoBanner';
import { Logo } from './components/Logo';
import { PeopleView } from './views/PeopleView';
import { TagModal } from './modals/TagModal';
import { UserActionsContext, type UserActions } from './lib/userActions';
import { SpaceRail } from './components/SpaceRail';
import { SpacePage } from './views/SpacePage';
import { suggestedHandle } from './lib/handles';
import { FilesView } from './views/FilesView';
import { FeedView } from './views/FeedView';
import { DirectoryView } from './views/DirectoryView';
import { DocView } from './views/DocView';

type View =
  | { kind: 'home' }
  | { kind: 'feed' }
  | { kind: 'directory' }
  | { kind: 'people' }
  | { kind: 'files' }
  | { kind: 'doc'; docId: string }
  | { kind: 'channel' }
  | { kind: 'new-space' }
  | { kind: 'profile'; userId: string };

export function App() {
  const [me, setMe] = useState<MeDto | null>(null);
  const [checked, setChecked] = useState(false);
  // Creating a space needs no account — anyone can start their own.
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    // Profiles saved before a theme was retired fall back to the default.
    const theme = me?.theme;
    document.documentElement.dataset.theme =
      theme && (THEMES as readonly string[]).includes(theme) ? theme : 'ocean';
  }, [me?.theme]);

  if (!checked) return null;
  if (!me) {
    return (
      <div className="app">
        <SpaceRail onNewSpace={() => setNewSpaceOpen(true)} newActive={newSpaceOpen} onCurrent={() => setNewSpaceOpen(false)} />
        {newSpaceOpen ? (
          <SpacePage />
        ) : (
          <Login onLogin={async () => setMe(await api.me())} onNewSpace={() => setNewSpaceOpen(true)} />
        )}
      </div>
    );
  }
  return <Workspace me={me} onMeChange={setMe} />;
}


function Login({ onLogin, onNewSpace }: { onLogin: () => Promise<void>; onNewSpace: () => void }) {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function link() {
    setError(null);
    try {
      await api.importIdentity(linkCode.trim());
      await onLogin();
    } catch {
      setError('That code did not match anyone in this space.');
    }
  }

  async function signIn(userHandle: string) {
    setError(null);
    try {
      await api.login(userHandle);
      await onLogin();
    } catch {
      setError('Signing in did not stick — the session cookie was rejected or the server is unreachable.');
    }
  }

  useEffect(() => {
    Promise.all([api.users().then(setUsers), api.space().then(setSpace)])
      .catch(console.error)
      .finally(() => setLoaded(true));
  }, []);

  async function create() {
    if (!name.trim()) return;
    setError(null);
    setPending(true);
    try {
      await api.createProfile({ name, handle: handle || suggestedHandle(name) });
      await onLogin();
    } catch (err) {
      setPending(false);
      setError(err instanceof Error && err.message.includes('409') ? 'That handle is taken here.' : 'Could not create the profile.');
    }
  }

  const firstEver = users.length === 0;
  const unnamed = space?.name === 'local';

  if (!loaded) return null;
  if (firstEver && unnamed && !linking) {
    return (
      <SpacePage
        placeholder
        footer={
          <button className="login-space-link" onClick={() => setLinking(true)}>
            Already use Frith on another device? Link this one →
          </button>
        }
      />
    );
  }

  // The left column is fixed (brand + whatever action is in flight); only
  // the account list on the right scrolls.
  return (
    <div className="login">
      <aside className="login-side">
        <h1 className="login-brand">
          <Logo size={40} /> Frith
        </h1>
        <p>
          {space ? <b>{space.name}</b> : 'This space'} lives on this device — nothing goes to a server, and only
          people with the invite can connect.
        </p>

        {(creating || (firstEver && !linking)) && (
          <div className="login-create">
            {firstEver && (
              <p className="login-first">You're the first one in {space?.name}. Make yourself a profile to get started.</p>
            )}
            <label className="field">
              <span>Your name</span>
              <input
                autoFocus
                value={name}
                placeholder="e.g. Mika Sørensen"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!handleTouched) setHandle(suggestedHandle(e.target.value));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                }}
              />
            </label>
            <label className="field">
              <span>Handle</span>
              <input
                value={handle}
                placeholder="mika"
                onChange={(e) => {
                  setHandleTouched(true);
                  setHandle(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                }}
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <div className="login-create-actions">
              {!firstEver && (
                <button className="btn" onClick={() => setCreating(false)}>
                  Back
                </button>
              )}
              <button className="btn primary" disabled={!name.trim() || pending} onClick={() => void create()}>
                {pending ? 'Setting up your profile…' : `Join as ${name.trim() ? `@${handle || suggestedHandle(name)}` : '…'}`}
              </button>
            </div>
          </div>
        )}

        {linking && (
          <div className="login-create">
            <label className="field">
              <span>Identity code from your other device</span>
              <input
                autoFocus
                value={linkCode}
                placeholder="frith-id:…"
                onChange={(e) => setLinkCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void link();
                }}
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <div className="login-create-actions">
              <button className="btn" onClick={() => setLinking(false)}>
                Back
              </button>
              <button className="btn primary" disabled={!linkCode.trim()} onClick={() => void link()}>
                Link this device
              </button>
            </div>
          </div>
        )}

        {!creating && !firstEver && !linking && (
          <div className="login-actions">
            <button className="btn primary login-new" onClick={() => setCreating(true)}>
              <Icon name="sparkle" /> I'm new — create my profile
            </button>
            <button className="login-space-link" onClick={() => setLinking(true)}>
              Already use Frith on another device? Link this one →
            </button>
            <button className="login-space-link" onClick={onNewSpace}>
              Join or start another space →
            </button>
          </div>
        )}
        {firstEver && !linking && (
          <div className="login-actions">
            <button className="login-space-link" onClick={() => setLinking(true)}>
              Already use Frith on another device? Link this one →
            </button>
            <button className="login-space-link" onClick={onNewSpace}>
              Join or start another space →
            </button>
          </div>
        )}
      </aside>

      {!firstEver && space?.devAuth && (
        <div className="login-content">
          <div className="login-list-h">Sign in as (dev)</div>
          {!creating && !linking && error && <div className="form-error">{error}</div>}
          <div className="login-list">
            {users.map((u) => (
              <button key={u.id} onClick={() => void signIn(u.handle)}>
                <Avatar name={u.name} />
                <span className="login-user">
                  <span className="login-name">{u.name}</span>
                  <span className="login-meta">
                    <span className="handle">@{u.handle}</span>
                    {(u.title || u.team) && (
                      <span className="login-title">{[u.title, u.team].filter(Boolean).join(' · ')}</span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Workspace({ me, onMeChange }: { me: MeDto; onMeChange: (me: MeDto) => void }) {
  // Refresh keeps your place: the view survives reload in sessionStorage
  // (per-tab, so a stale channel from another space dies with the tab).
  const [view, setView] = useState<View>(() => {
    try {
      const raw = sessionStorage.getItem('frith:view');
      if (raw) return JSON.parse(raw) as View;
    } catch {
      /* corrupted state → home */
    }
    return { kind: 'home' };
  });
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const showFlash = useCallback((message: string) => {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 5000);
  }, []);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(() => sessionStorage.getItem('frith:activeChannel'));
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [threadRoot, setThreadRoot] = useState<MessageDto | null>(null);
  const [homeTick, setHomeTick] = useState(0);
  const [feedTick, setFeedTick] = useState(0);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [palettesOpen, setPalettesOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [openedTag, setOpenedTag] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledMessageDto[]>([]);
  const [docs, setDocs] = useState<DocDto[]>([]);

  // Campfires (calls)
  const [calls, setCalls] = useState<Record<string, string[]>>({});
  const [callRecorders, setCallRecorders] = useState<Record<string, string[]>>({});
  const [myCall, setMyCall] = useState<{ channelId: string; withVideo: boolean } | null>(null);
  const [callStreams, setCallStreams] = useState<Map<string, MediaStream>>(new Map());
  const [callScreens, setCallScreens] = useState<Map<string, MediaStream>>(new Map());
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const callManager = useRef<CallManager | null>(null);
  const callRecorder = useRef<CallRecorder | null>(null);

  useEffect(() => {
    api.space().then(setSpace).catch(console.error);
    api
      .calls()
      .then(({ calls, recorders }) => {
        setCalls(calls);
        setCallRecorders(recorders);
      })
      .catch(console.error);
    api.scheduled().then(setScheduled).catch(console.error);
    api.docs().then(setDocs).catch(console.error);
  }, []);

  const startCall = useCallback(async (channelId: string, withVideo: boolean) => {
    if (callManager.current) return; // one campfire at a time
    const { participants } = await api.joinCall(channelId);
    const manager = new CallManager((streams, screens) => {
      setCallStreams(streams);
      setCallScreens(screens);
      // Anyone arriving mid-recording gets mixed into the file too.
      for (const stream of streams.values()) callRecorder.current?.addAudio(stream);
    });
    manager.onShareEnd = () => setSharing(false);
    callManager.current = manager;
    setMuted(false);
    setVideoOn(withVideo);
    setSharing(false);
    setRecording(false);
    setMyCall({ channelId, withVideo });
    await manager.join(channelId, withVideo, participants);
    // The local stream exists only now — nudge a render so the self tile paints.
    setMyCall((cur) => (cur ? { ...cur } : cur));
  }, []);

  /** Stop the recorder and post the file to the channel it recorded. */
  const finishRecording = useCallback(async (channelId: string) => {
    const recorder = callRecorder.current;
    callRecorder.current = null;
    setRecording(false);
    void api.setCallRecording(channelId, false).catch(() => undefined);
    const blob = await recorder?.stop();
    if (!blob) return;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const ext = blob.type.startsWith('video/') ? 'webm' : 'weba';
    const file = new File([blob], `campfire ${stamp}.${ext}`, { type: blob.type });
    try {
      await api.attach(channelId, file, 'Campfire recording');
    } catch {
      // The channel may be archived or the upload over budget — keep the
      // recording alive as a download instead of dropping it silently.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  const toggleRecord = useCallback(async () => {
    if (!myCall) return;
    if (recording) {
      await finishRecording(myCall.channelId);
      return;
    }
    const consent = window.confirm(
      'Record this campfire?\n\nEveryone in the call (and anyone joining) will see that you are recording. When you stop, the recording is posted to the channel.',
    );
    if (!consent) return;
    const manager = callManager.current;
    const recorder = new CallRecorder();
    const stage = manager?.screen ?? [...callScreens.values()][0] ?? null;
    if (!recorder.start([manager?.local ?? null, ...callStreams.values()], stage)) return;
    callRecorder.current = recorder;
    setRecording(true);
    void api.setCallRecording(myCall.channelId, true).catch(() => undefined);
  }, [myCall, recording, callStreams, callScreens, finishRecording]);

  const leaveCall = useCallback(() => {
    if (!myCall) return;
    // A recording in flight is finished and posted, never dropped.
    if (callRecorder.current) void finishRecording(myCall.channelId);
    void api.leaveCall(myCall.channelId);
    callManager.current?.leave();
    callManager.current = null;
    setMyCall(null);
    setCallStreams(new Map());
    setCallScreens(new Map());
    setSharing(false);
  }, [myCall, finishRecording]);

  useEffect(() => {
    let cancelled = false;
    api.channels().then((cs) => {
      if (cancelled) return;
      setChannels(cs);
      // A restored id that no longer exists (deleted, other space) falls back.
      setActiveId((cur) =>
        cur && cs.some((c) => c.id === cur) ? cur : (cs.find((c) => c.type === 'public')?.id ?? cs[0]?.id ?? null),
      );
      if (cs.length === 0) setView((cur) => (cur.kind === 'channel' ? { kind: 'home' } : cur));
    });
    api.users().then((us) => {
      if (!cancelled) setUsers(us);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh keeps your place (the other half lives in the view initializer).
  useEffect(() => {
    const placeToKeep = view.kind === 'new-space' ? { kind: 'home' } : view;
    sessionStorage.setItem('frith:view', JSON.stringify(placeToKeep));
    if (activeId) sessionStorage.setItem('frith:activeChannel', activeId);
  }, [view, activeId]);

  useEffect(() => {
    if (!activeId) return;
    setThreadRoot(null);
    setMessages([]);
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

  const openFeed = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setFeedTick((t) => t + 1);
    setView({ kind: 'feed' });
  }, [closeOverlays]);

  const openDirectory = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setView({ kind: 'directory' });
  }, [closeOverlays]);

  const openPeople = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setView({ kind: 'people' });
  }, [closeOverlays]);

  const openFiles = useCallback(() => {
    closeOverlays();
    setThreadRoot(null);
    setView({ kind: 'files' });
  }, [closeOverlays]);

  const openDoc = useCallback(
    (docId: string) => {
      closeOverlays();
      setThreadRoot(null);
      setView({ kind: 'doc', docId });
    },
    [closeOverlays],
  );

  const archiveChannel = useCallback(
    async (channelId: string) => {
      try {
        await api.setArchived(channelId, true);
        setChannels(await api.channels());
      } catch (err) {
        showFlash(err instanceof Error ? err.message.replace(/^\d+\s*\{"error":"(.*)"\}$/, '$1') : 'Could not archive that channel.');
      }
    },
    [showFlash],
  );

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
        // A profile change can be a new "currently enjoying" — feed material.
        if (view.kind === 'feed') setFeedTick((t) => t + 1);
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
      if (event.type === 'call.recording') {
        setCallRecorders((cur) => {
          const next = { ...cur };
          if (event.recorders.length > 0) next[event.channelId] = event.recorders;
          else delete next[event.channelId];
          return next;
        });
        return;
      }
      if (event.type === 'call.draw') return; // the screen stage renders ink on its own socket
      if (event.type === 'reaction.changed') {
        if (event.channelId === activeId) {
          setMessages((cur) => applyReaction(cur, event, me.id));
        }
        return;
      }
      if (event.type === 'docs.changed') {
        if (view.kind === 'feed') setFeedTick((t) => t + 1);
        void api.docs().then((next) => {
          setDocs(next);
          // If the doc we're looking at was removed, fall back home.
          setView((cur) => (cur.kind === 'doc' && !next.some((d) => d.id === cur.docId) ? { kind: 'home' } : cur));
        });
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
      if (view.kind === 'feed') setFeedTick((t) => t + 1);
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
      try {
        const { channelId } = await api.openDm(userId);
        setChannels(await api.channels());
        openChannel(channelId);
      } catch (err) {
        console.error(err);
        showFlash('Could not open that conversation — the server refused or is unreachable.');
      }
    },
    [openChannel, showFlash],
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
        // Modal-based dialogs close themselves (Modal.tsx, capture phase).
        if (switcherOpen) setSwitcherOpen(false);
        else if (askOpen) setAskOpen(false);
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
  }, [channels, activeId, openChannel, switcherOpen, askOpen]);

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
    { name: 'home', hint: 'Back to your digest', run: () => openHome() },
    { name: 'feed', hint: "What your people shared — chronological, that's it", run: () => openFeed() },
    { name: 'directory', hint: 'Public communities you could join', run: () => openDirectory() },
    { name: 'storage', hint: 'What this device stores & auto-downloads', run: () => setStorageOpen(true) },
    { name: 'devices', hint: 'Link another device to your identity', run: () => setDevicesOpen(true) },
    { name: 'palettes', hint: 'Try on colour combos, live', run: () => setPalettesOpen(true) },
    { name: 'logout', hint: 'Back to the profile picker', run: () => void api.logout().then(() => window.location.reload()) },
    {
      name: 'feedback',
      hint: 'Suggest a feature or report a bug on GitHub',
      run: () => window.open('https://github.com/liywjl/frith/issues/new', '_blank', 'noopener'),
    },
    {
      name: 'archive',
      hint: 'Archive this channel (stays searchable)',
      run: () => active && active.type !== 'dm' && void archiveChannel(active.id),
    },
  ];

  const userActions: UserActions = useMemo(
    () => ({
      openDm: (userId) => void openDm(userId),
      openProfile,
      openTag: setOpenedTag,
      getUser: (userId) => users.find((u) => u.id === userId),
      userByHandle: (handle) => users.find((u) => u.handle.toLowerCase() === handle.toLowerCase()),
      isOnline: (userId) => online.has(userId),
    }),
    [openDm, openProfile, users, online],
  );

  return (
    <UserActionsContext.Provider value={userActions}>
    {space?.demo && (
      <DemoBanner
        onReset={() => {
          if (!window.confirm('Leave the demo and delete its content from this device?')) return;
          void api.demoReset().then(() => window.location.reload());
        }}
      />
    )}
    <div className={space?.demo ? 'app app-demo' : 'app'}>
      <SpaceRail onNewSpace={() => setView({ kind: 'new-space' })} newActive={view.kind === 'new-space'} onCurrent={openHome} />
      <Sidebar
        me={me}
        channels={channels}
        users={users}
        online={online}
        activeId={view.kind === 'channel' ? activeId : null}
        homeActive={view.kind === 'home'}
        feedActive={view.kind === 'feed'}
        directoryActive={view.kind === 'directory'}
        peopleActive={view.kind === 'people'}
        filesActive={view.kind === 'files'}
        docs={docs}
        activeDocId={view.kind === 'doc' ? view.docId : null}
        space={space}
        liveCalls={new Set(Object.keys(calls).filter((id) => (calls[id] ?? []).length > 0))}
        onHome={openHome}
        onFeed={openFeed}
        onDirectory={openDirectory}
        onPeople={openPeople}
        onFiles={openFiles}
        onDoc={openDoc}
        onNewDoc={() => {
          // Notion-style: no naming dialog — a fresh Untitled page, cursor in
          // the title, rename in place.
          void api.createDoc('Untitled').then((doc) => {
            setDocs((cur) => [doc, ...cur.filter((d) => d.id !== doc.id)]);
            openDoc(doc.id);
          });
        }}
        onOpenSpace={() => setSpaceOpen(true)}
        onSelect={openChannel}
        onNewGroup={() => setGroupOpen(true)}
        onNewChannel={() => setCreateChannelOpen(true)}
        onTogglePin={(id, pinned) => void togglePin(id, pinned)}
        onReorderPins={(ids) => void reorderPins(ids)}
        onMeChange={onMeChange}
      />
      {view.kind === 'files' && <FilesView onOpenChannel={openChannel} />}
      {view.kind === 'feed' && (
        <FeedView refreshTick={feedTick} onOpenChannel={openChannel} onOpenDoc={openDoc} onOpenThread={openThread} />
      )}
      {view.kind === 'directory' && <DirectoryView />}
      {view.kind === 'doc' && (
        <DocView
          docId={view.docId}
          canManage={space?.canManage ?? false}
          meId={me.id}
          onRemoved={() => setView({ kind: 'home' })}
        />
      )}
      {view.kind === 'people' && (
        <PeopleView
          me={me}
          users={users}
          online={online}
          space={space}
          onToggleBlock={(userId, blocked) => void toggleBlock(userId, blocked)}
          onInvite={() => setSpaceOpen(true)}
        />
      )}
      {view.kind === 'home' && (
        <HomeView
          me={me}
          refreshTick={homeTick}
          onOpenChannel={openChannel}
          onOpenThread={openThread}
          onOpenAsk={() => setAskOpen(true)}
          onStartGroup={(userIds) => void api.createGroup(userIds).then(({ channelId }) => onGroupCreated(channelId))}
          channelCount={channels.length}
          onNewChannel={() => setCreateChannelOpen(true)}
          onInvite={() => setSpaceOpen(true)}
        />
      )}
      {view.kind === 'profile' && (
        <ProfileView
          userId={view.userId}
          me={me}
          online={online}
          onOpenDm={openDm}
          onOpenChannel={openChannel}
          onOpenDoc={openDoc}
          onOpenThread={openThread}
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
          callRecording={(callRecorders[active.id] ?? []).length > 0}
          inCall={myCall?.channelId === active.id}
          onStartCall={(withVideo) => void startCall(active.id, withVideo)}
          onArchive={() => void archiveChannel(active.id)}
          canArchive={active.type === 'private' || (space?.canManage ?? false)}
          commands={slashCommands}
          scheduled={scheduled.filter((s) => s.channelId === active.id)}
          onCancelScheduled={(id) =>
            void api.cancelScheduled(id).then(() => setScheduled((cur) => cur.filter((s) => s.id !== id)))
          }
          onOpenThread={setThreadRoot}
          onOpenAsk={() => setAskOpen(true)}
          meId={me.id}
          onLeft={() => {
            void api.channels().then(setChannels);
            openHome();
          }}
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
      {spaceOpen && space && <SpaceModal space={space} onSpaceChange={setSpace} onClose={() => setSpaceOpen(false)} />}
      {view.kind === 'new-space' && <SpacePage overlay />}
      {storageOpen && <StorageModal onClose={() => setStorageOpen(false)} />}
      {devicesOpen && <DevicesModal onClose={() => setDevicesOpen(false)} />}
      {palettesOpen && <PaletteModal onClose={() => setPalettesOpen(false)} />}
      {openedTag && <TagModal tag={openedTag} users={users} meId={me.id} onClose={() => setOpenedTag(null)} />}
      {myCall && (
        <CallPanel
          channelId={myCall.channelId}
          channelLabel={(() => {
            const c = channels.find((ch) => ch.id === myCall.channelId);
            return c ? (c.type === 'dm' ? (c.dmPartnerNames ?? []).join(', ') : `# ${c.name}`) : 'campfire';
          })()}
          meId={me.id}
          meName={me.name}
          meEmoji={me.avatarEmoji}
          participants={calls[myCall.channelId] ?? [me.id]}
          streams={callStreams}
          screens={callScreens}
          localStream={callManager.current?.local ?? null}
          localScreen={callManager.current?.screen ?? null}
          muted={muted}
          videoOn={videoOn}
          sharing={sharing}
          recorderIds={callRecorders[myCall.channelId] ?? []}
          recording={recording}
          onToggleRecord={() => void toggleRecord()}
          onPostTranscript={(text) => void api.send(myCall.channelId, `Transcript (local, experimental):\n${text}`)}
          onToggleShare={() => {
            const manager = callManager.current;
            if (!manager) return;
            if (sharing) {
              void manager.stopShare().then(() => setSharing(false));
            } else {
              void manager.shareScreen().then((ok) => ok && setSharing(true));
            }
          }}
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
      {flash && <div className="flash-error">{flash}</div>}
    </div>
    </UserActionsContext.Provider>
  );
}
