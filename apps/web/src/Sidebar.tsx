import type { ChannelDto, UserDto } from '@app/shared';

function Presence({ online }: { online: boolean }) {
  return <span className={`presence ${online ? 'on' : ''}`} aria-label={online ? 'online' : 'offline'} />;
}

function Unread({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="unread-badge">{count}</span>;
}

export function Sidebar({
  me,
  channels,
  users,
  online,
  activeId,
  onSelect,
  onOpenDm,
}: {
  me: UserDto;
  channels: ChannelDto[];
  users: UserDto[];
  online: Set<string>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenDm: (userId: string) => void;
}) {
  const rooms = channels.filter((c) => c.type !== 'dm');
  const dms = channels.filter((c) => c.type === 'dm');
  const dmPartnerIds = new Set(dms.flatMap((c) => c.dmPartnerIds ?? []));
  const others = users.filter((u) => u.id !== me.id && !dmPartnerIds.has(u.id));

  return (
    <nav className="sidebar">
      <div className="ws-name">
        Lore <span className="ws-sub">Acme</span>
      </div>

      <div className="side-h">Channels</div>
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

      <div className="side-h" title="Direct messages are never indexed by the AI">
        Direct messages 🔒
      </div>
      {dms.map((c) => (
        <button
          key={c.id}
          className={`side-item ${c.id === activeId ? 'active' : ''} ${c.unreadCount > 0 ? 'has-unread' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          <Presence online={(c.dmPartnerIds ?? []).some((id) => online.has(id))} />
          <span className="side-label">{c.dmPartnerNames?.join(', ') || c.name}</span>
          <Unread count={c.unreadCount} />
        </button>
      ))}
      {others.map((u) => (
        <button key={u.id} className="side-item muted" onClick={() => onOpenDm(u.id)}>
          <Presence online={online.has(u.id)} />
          <span className="side-label">{u.name}</span>
        </button>
      ))}

      <div className="side-me">
        <Presence online={true} />
        <b>{me.name}</b>
        <span className="side-hints">⌘K jump · ⌘J ask</span>
      </div>
    </nav>
  );
}
