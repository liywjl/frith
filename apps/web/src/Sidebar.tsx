import { useState } from 'react';
import type { ChannelDto, SpaceDto, UserDto } from '@app/shared';
import { Avatar } from './Avatar';
import { useUserActions } from './userActions';

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
  space,
  onHome,
  onTask,
  onOpenSpace,
  onSelect,
  onNewGroup,
  onNewChannel,
}: {
  me: UserDto;
  channels: ChannelDto[];
  users: UserDto[];
  online: Set<string>;
  activeId: string | null;
  homeActive: boolean;
  taskActive: boolean;
  space: SpaceDto | null;
  onHome: () => void;
  onTask: () => void;
  onOpenSpace: () => void;
  onSelect: (id: string) => void;
  onNewGroup: () => void;
  onNewChannel: () => void;
}) {
  const { openDm, openProfile } = useUserActions();
  const [showArchived, setShowArchived] = useState(false);
  const rooms = channels.filter((c) => c.type !== 'dm' && !c.archivedAt);
  const archived = channels.filter((c) => c.type !== 'dm' && c.archivedAt);
  const dms = channels.filter((c) => c.type === 'dm');
  const byId = new Map(users.map((u) => [u.id, u]));
  // Users without an existing 1:1 conversation (groups don't count).
  const soloPartnerIds = new Set(
    dms.filter((c) => (c.dmPartnerIds ?? []).length === 1).flatMap((c) => c.dmPartnerIds ?? []),
  );
  const others = users.filter((u) => u.id !== me.id && !soloPartnerIds.has(u.id));

  return (
    <nav className="sidebar">
      <div className="ws-name">
        Lore <span className="ws-sub">Acme</span>
      </div>

      <button className={`side-item home-item ${homeActive ? 'active' : ''}`} onClick={onHome}>
        <span className="side-label">🏠 Home</span>
      </button>
      <button className={`side-item home-item ${taskActive ? 'active' : ''}`} onClick={onTask}>
        <span className="side-label">🎯 Start a task</span>
      </button>
      <button className="side-item home-item" title="Your P2P space — invite people" onClick={onOpenSpace}>
        <span className="side-label">🛰 {space ? space.name : 'Join a space'}</span>
        {space && space.connectedPeers > 0 && <span className="peer-badge">{space.connectedPeers} ⇄</span>}
      </button>

      <div className="side-h side-h-action">
        <span>Channels</span>
        <button className="side-add" title="Create a channel" onClick={onNewChannel}>
          +
        </button>
      </div>
      {rooms.map((c) => (
        <button
          key={c.id}
          className={`side-item ${c.id === activeId ? 'active' : ''} ${c.unreadCount > 0 ? 'has-unread' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          <span className="side-label"># {c.name}</span>
          {c.type === 'private' && <span className="lock" title="Private channel">🔒</span>}
          <Unread count={c.unreadCount} />
        </button>
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
      {dms.map((c) => {
        const partnerIds = c.dmPartnerIds ?? [];
        const isGroup = partnerIds.length > 1;
        const solo = !isGroup ? byId.get(partnerIds[0] ?? '') : undefined;
        return (
          <button
            key={c.id}
            className={`side-item ${c.id === activeId ? 'active' : ''} ${c.unreadCount > 0 ? 'has-unread' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            {isGroup ? (
              <span className="group-icon">{partnerIds.length + 1}</span>
            ) : (
              <Presence online={partnerIds.some((id) => online.has(id))} />
            )}
            <span className="side-label">{c.dmPartnerNames?.join(', ') || c.name}</span>
            {solo && <Status user={solo} />}
            <Unread count={c.unreadCount} />
          </button>
        );
      })}
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
      <div className="side-hints">⌘K jump · ⌘J ask</div>
    </nav>
  );
}
