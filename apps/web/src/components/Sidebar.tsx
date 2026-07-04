import { useState } from 'react';
import type { ChannelDto, SpaceDto, UserDto } from '@app/shared';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
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
  taskActive,
  peopleActive,
  space,
  liveCalls,
  onHome,
  onTask,
  onPeople,
  onOpenSpace,
  onSelect,
  onNewGroup,
  onNewChannel,
  onTogglePin,
  onReorderPins,
}: {
  me: UserDto;
  channels: ChannelDto[];
  users: UserDto[];
  online: Set<string>;
  activeId: string | null;
  homeActive: boolean;
  taskActive: boolean;
  peopleActive: boolean;
  space: SpaceDto | null;
  liveCalls: Set<string>;
  onHome: () => void;
  onTask: () => void;
  onPeople: () => void;
  onOpenSpace: () => void;
  onSelect: (id: string) => void;
  onNewGroup: () => void;
  onNewChannel: () => void;
  onTogglePin: (channelId: string, pinned: boolean) => void;
  onReorderPins: (channelIds: string[]) => void;
}) {
  const { openDm, openProfile } = useUserActions();
  const [showArchived, setShowArchived] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const byId = new Map(users.map((u) => [u.id, u]));
  const pinnedChannels = channels
    .filter((c) => c.pinned !== null && !c.archivedAt)
    .sort((a, b) => (a.pinned ?? 0) - (b.pinned ?? 0));
  const pinnedIds = new Set(pinnedChannels.map((c) => c.id));
  const rooms = channels.filter((c) => c.type !== 'dm' && !c.archivedAt && !pinnedIds.has(c.id));
  const archived = channels.filter((c) => c.type !== 'dm' && c.archivedAt);
  const dms = channels.filter((c) => c.type === 'dm' && !pinnedIds.has(c.id));
  const soloPartnerIds = new Set(
    channels
      .filter((c) => c.type === 'dm' && (c.dmPartnerIds ?? []).length === 1)
      .flatMap((c) => c.dmPartnerIds ?? []),
  );
  const others = users.filter((u) => u.id !== me.id && !soloPartnerIds.has(u.id));

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
          {liveCalls.has(c.id) && <span title="Campfire burning">🔥</span>}
          {c.type === 'private' && <span className="lock" title="Private channel">🔒</span>}
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
      <div className="ws-name">
        <Logo /> Lore {space && <span className="ws-sub">{space.name}</span>}
      </div>

      <button className={`side-item home-item ${homeActive ? 'active' : ''}`} onClick={onHome}>
        <span className="side-label">🏠 Home</span>
      </button>
      <button className={`side-item home-item ${taskActive ? 'active' : ''}`} onClick={onTask}>
        <span className="side-label">🎯 Start a task</span>
      </button>
      <button className={`side-item home-item ${peopleActive ? 'active' : ''}`} onClick={onPeople}>
        <span className="side-label">👥 People</span>
      </button>
      <button className="side-item home-item" title="Your P2P space — invite people" onClick={onOpenSpace}>
        <span className="side-label">🛰 {space ? space.name : 'Join a space'}</span>
        {space && space.connectedPeers > 0 && <span className="peer-badge">{space.connectedPeers} ⇄</span>}
      </button>

      {pinnedChannels.length > 0 && (
        <>
          <div className="side-h" title="Drag to reorder">★ Favourites</div>
          {pinnedChannels.map((c) => (
            <ChannelRow key={c.id} c={c} draggable />
          ))}
        </>
      )}

      <div className="side-h side-h-action">
        <span>Channels</span>
        <button className="side-add" title="Create a channel" onClick={onNewChannel}>
          +
        </button>
      </div>
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
                <span className="side-label">🗄 {c.name}</span>
              </button>
            ))}
        </>
      )}

      <div className="side-h side-h-action" title="Direct messages are never indexed by the AI">
        <span>Direct messages 🔒</span>
        <button className="side-add" title="New group conversation" onClick={onNewGroup}>
          +
        </button>
      </div>
      {dms.map((c) => (
        <ChannelRow key={c.id} c={c} />
      ))}
      {others.map((u) => (
        <button
          key={u.id}
          className="side-item muted"
          title={`Message ${u.name}`}
          onClick={() => openDm(u.id)}
        >
          <Presence online={online.has(u.id)} />
          <span className="side-label">{u.name}</span>
          <Status user={u} />
        </button>
      ))}

      <button className="side-me" title="View your profile" onClick={() => openProfile(me.id)}>
        <Avatar name={me.name} emoji={me.avatarEmoji} />
        <span className="side-me-text">
          <b>
            {me.name} <Status user={me} />
          </b>
          <span className="side-me-sub">{[me.title, me.team].filter(Boolean).join(' · ') || 'Set up your profile'}</span>
        </span>
      </button>
      <div className="side-hints">⌘K jump · ⌘J ask · / actions</div>
    </nav>
  );
}
