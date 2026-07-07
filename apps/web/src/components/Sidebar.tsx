import { useMemo, useState } from 'react';
import type { ChannelDto, DocDto, MeDto, SpaceDto, UserDto } from '@app/shared';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { SpaceLogo } from './SpaceLogo';
import { StatusPopover } from './StatusPopover';
import { useUserActions } from '../lib/userActions';

function Presence({ online }: { online: boolean }) {
  return <span className={`presence ${online ? 'on' : ''}`} aria-label={online ? 'online' : 'offline'} />;
}

function Unread({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="unread-badge">{count}</span>;
}

function Status({ user }: { user: UserDto }) {
  if (!user.statusEmoji) return null;
  return (
    <span className="status-emoji" title={user.statusText ?? undefined}>
      {user.statusEmoji}
    </span>
  );
}

export function Sidebar({
  me,
  channels,
  users,
  online,
  activeId,
  homeActive,
  peopleActive,
  filesActive,
  docs,
  activeDocId,
  space,
  liveCalls,
  onHome,
  onPeople,
  onFiles,
  onDoc,
  onNewDoc,
  onOpenSpace,
  onSelect,
  onNewGroup,
  onNewChannel,
  onTogglePin,
  onReorderPins,
  onMeChange,
}: {
  me: MeDto;
  channels: ChannelDto[];
  users: UserDto[];
  online: Set<string>;
  activeId: string | null;
  homeActive: boolean;
  peopleActive: boolean;
  filesActive: boolean;
  docs: DocDto[];
  activeDocId: string | null;
  space: SpaceDto | null;
  liveCalls: Set<string>;
  onHome: () => void;
  onPeople: () => void;
  onFiles: () => void;
  onDoc: (docId: string) => void;
  onNewDoc: () => void;
  onOpenSpace: () => void;
  onSelect: (id: string) => void;
  onNewGroup: () => void;
  onNewChannel: () => void;
  onTogglePin: (channelId: string, pinned: boolean) => void;
  onReorderPins: (channelIds: string[]) => void;
  onMeChange: (me: MeDto) => void;
}) {
  const { openDm, openProfile } = useUserActions();
  const [showArchived, setShowArchived] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [statusAnchor, setStatusAnchor] = useState<{ left: number; top: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const Caret = ({ id }: { id: string }) => (
    <span className={`side-caret ${collapsed.has(id) ? '' : 'open'}`}>
      <Icon name="chevron" size={12} />
    </span>
  );

  // Derived lists change only when the rosters do — not on every hover,
  // popover, or drag re-render of the sidebar.
  const { byId, pinnedChannels, rooms, archived, dmEntries } = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u]));
    const pinnedChannels = channels
      .filter((c) => c.pinned !== null && !c.archivedAt)
      .sort((a, b) => (a.pinned ?? 0) - (b.pinned ?? 0));
    const pinnedIds = new Set(pinnedChannels.map((c) => c.id));
    const rooms = channels.filter((c) => c.type !== 'dm' && !c.archivedAt && !pinnedIds.has(c.id));
    const archived = channels.filter((c) => c.type !== 'dm' && c.archivedAt);
    // Quiet DMs fall off the list (still in ⌘K search and People) — the
    // sidebar shows who you actually talk to. Unread or brand-new ones stay.
    const DM_QUIET_DAYS = 30;
    const dmRecent = (c: ChannelDto) =>
      c.unreadCount > 0 ||
      !c.lastActivityAt ||
      Date.now() - new Date(c.lastActivityAt).getTime() < DM_QUIET_DAYS * 86_400_000;
    const dms = channels.filter((c) => c.type === 'dm' && !pinnedIds.has(c.id) && dmRecent(c));
    const soloPartnerIds = new Set(
      channels
        .filter((c) => c.type === 'dm' && (c.dmPartnerIds ?? []).length === 1)
        .flatMap((c) => c.dmPartnerIds ?? []),
    );
    const others = users.filter((u) => u.id !== me.id && !soloPartnerIds.has(u.id));
    // One alphabetical list, existing conversations and not-yet-messaged
    // people interleaved — so opening a DM never teleports the row.
    const dmEntries = [
      ...dms.map((c) => ({ label: c.dmPartnerNames?.join(', ') ?? c.name, channel: c as ChannelDto, user: null })),
      ...others.map((u) => ({ label: u.name, channel: null, user: u })),
    ].sort((a, b) => a.label.localeCompare(b.label));
    return { byId, pinnedChannels, rooms, archived, dmEntries };
  }, [channels, users, me.id]);

  function ChannelRow({ c, draggable }: { c: ChannelDto; draggable?: boolean }) {
    const partnerIds = c.dmPartnerIds ?? [];
    const isGroup = c.type === 'dm' && partnerIds.length > 1;
    const solo = c.type === 'dm' && !isGroup ? byId.get(partnerIds[0] ?? '') : undefined;
    const label = c.type === 'dm' ? (c.dmPartnerNames?.join(', ') ?? c.name) : `# ${c.name}`;
    const isPinned = c.pinned !== null;
    return (
      <div
        className={`side-row ${dragId === c.id ? 'dragging' : ''}`}
        draggable={draggable}
        onDragStart={() => setDragId(c.id)}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => {
          if (draggable && dragId && dragId !== c.id) e.preventDefault();
        }}
        onDrop={() => {
          if (!draggable || !dragId || dragId === c.id) return;
          const order = pinnedChannels.map((p) => p.id).filter((id) => id !== dragId);
          order.splice(order.indexOf(c.id), 0, dragId);
          onReorderPins(order);
          setDragId(null);
        }}
      >
        <button
          className={`side-item ${c.id === activeId ? 'active' : ''} ${c.unreadCount > 0 ? 'has-unread' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          {c.type === 'dm' ? (
            isGroup ? (
              <span className="group-icon">{partnerIds.length + 1}</span>
            ) : (
              <Presence online={partnerIds.some((id) => online.has(id))} />
            )
          ) : null}
          <span className="side-label">{label}</span>
          {liveCalls.has(c.id) && <span className="live-flame" title="Campfire burning"><Icon name="flame" /></span>}
          {c.type === 'private' && <span className="lock" title="Private channel"><Icon name="lock" /></span>}
          {solo && <Status user={solo} />}
          <Unread count={c.unreadCount} />
        </button>
        <button
          className={`pin-btn ${isPinned ? 'pinned' : ''}`}
          title={isPinned ? 'Unpin' : 'Pin to favourites'}
          onClick={() => onTogglePin(c.id, !isPinned)}
        >
          {isPinned ? '★' : '☆'}
        </button>
      </div>
    );
  }

  return (
    <nav className="sidebar">
      {/* Fixed top: identity + destinations. */}
      <div className="side-top">
        <div className="ws-name">
          <Logo /> Frith {space && <span className="ws-sub">{space.name}</span>}
        </div>

        <button className={`side-item home-item ${homeActive ? 'active' : ''}`} onClick={onHome}>
          <span className="side-label"><Icon name="home" /> Home</span>
        </button>
        <button className={`side-item home-item ${peopleActive ? 'active' : ''}`} onClick={onPeople}>
          <span className="side-label"><Icon name="people" /> People</span>
        </button>
        <button className={`side-item home-item ${filesActive ? 'active' : ''}`} onClick={onFiles}>
          <span className="side-label"><Icon name="folder" /> Files</span>
        </button>
        <button
          className="side-item home-item"
          title={space ? `About “${space.name}”${space.canManage ? ' — settings & invites' : ''}` : 'Join a space'}
          onClick={onOpenSpace}
        >
          <span className="side-label">
            {space ? <SpaceLogo space={space} /> : <Icon name="globe" />} {space ? space.name : 'Join a space'}
          </span>
          {space && space.connectedPeers > 0 && <span className="peer-badge">{space.connectedPeers} ⇄</span>}
        </button>

        <div className="side-h side-h-action">
          <button className="side-h-toggle" onClick={() => toggle('docs')} aria-expanded={!collapsed.has('docs')}>
            <Caret id="docs" /> Docs
          </button>
          <button className="side-add" title="New shared doc" onClick={onNewDoc}>
            <Icon name="plus" />
          </button>
        </div>
        {!collapsed.has('docs') &&
          docs.map((d) => (
            <button
              key={d.id}
              className={`side-item ${d.id === activeDocId ? 'active' : ''}`}
              onClick={() => onDoc(d.id)}
            >
              <span className="side-label">
                <Icon name="doc" /> {d.title}
              </span>
            </button>
          ))}

        {pinnedChannels.length > 0 && (
          <>
            <div className="side-h" title="Drag to reorder">★ Favourites</div>
            {pinnedChannels.map((c) => (
              <ChannelRow key={c.id} c={c} draggable />
            ))}
          </>
        )}
      </div>

      {/* Channels and DMs scroll independently between the fixed ends. */}
      <div className="side-scrolls">
        <div className={`side-block ${collapsed.has('channels') ? 'collapsed' : ''}`}>
          <div className="side-h side-h-action">
            <button className="side-h-toggle" onClick={() => toggle('channels')} aria-expanded={!collapsed.has('channels')}>
              <Caret id="channels" /> Channels
            </button>
            <button className="side-add" title="Create a channel" onClick={onNewChannel}>
              <Icon name="plus" />
            </button>
          </div>
          {!collapsed.has('channels') && (
            <>
              {rooms.map((c) => (
                <ChannelRow key={c.id} c={c} />
              ))}
              {archived.length > 0 && (
                <>
                  <button className="side-item muted archived-toggle" onClick={() => setShowArchived((v) => !v)}>
                    <span className="side-label">
                      {showArchived ? '▾' : '▸'} Archived ({archived.length})
                    </span>
                  </button>
                  {showArchived &&
                    archived.map((c) => (
                      <button
                        key={c.id}
                        className={`side-item muted ${c.id === activeId ? 'active' : ''}`}
                        onClick={() => onSelect(c.id)}
                      >
                        <span className="side-label"><Icon name="archive" /> {c.name}</span>
                      </button>
                    ))}
                </>
              )}
            </>
          )}
        </div>

        <div className={`side-block ${collapsed.has('dms') ? 'collapsed' : ''}`}>
          <div className="side-h side-h-action" title="Direct messages are never indexed by the AI">
            <button className="side-h-toggle" onClick={() => toggle('dms')} aria-expanded={!collapsed.has('dms')}>
              <Caret id="dms" /> Direct messages <Icon name="lock" />
            </button>
            <button className="side-add" title="New group conversation" onClick={onNewGroup}>
              <Icon name="plus" />
            </button>
          </div>
          {!collapsed.has('dms') &&
            dmEntries.map((entry) =>
              entry.channel ? (
                <ChannelRow key={entry.channel.id} c={entry.channel} />
              ) : (
                <button
                  key={entry.user.id}
                  className="side-item muted"
                  title={`Message ${entry.user.name}`}
                  onClick={() => openDm(entry.user.id)}
                >
                  <Presence online={online.has(entry.user.id)} />
                  <span className="side-label">{entry.user.name}</span>
                  <Status user={entry.user} />
                </button>
              ),
            )}
        </div>
      </div>

      {/* Fixed bottom: you + the shortcuts. Clicking opens a quick status setter. */}
      <div className="side-foot">
        <button
          className="side-me"
          title="Set your status"
          onClick={(e) => setStatusAnchor(e.currentTarget.getBoundingClientRect())}
        >
          <Avatar name={me.name} emoji={me.avatarEmoji} />
          <span className="side-me-text">
            <b>
              {me.name} <Status user={me} />
            </b>
            <span className="side-me-sub">
              {me.statusText || [me.title, me.team].filter(Boolean).join(' · ') || 'Set a status'}
            </span>
          </span>
        </button>
        <div className="side-hints">⌘K jump · ⌘J ask · / actions</div>
      </div>
      {statusAnchor && (
        <StatusPopover
          me={me}
          anchor={statusAnchor}
          onSaved={onMeChange}
          onClose={() => setStatusAnchor(null)}
          onViewProfile={() => openProfile(me.id)}
        />
      )}
    </nav>
  );
}
