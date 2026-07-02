import type { ChannelDto, UserDto } from '@app/shared';

export function Sidebar({
  me,
  channels,
  activeId,
  onSelect,
}: {
  me: UserDto;
  channels: ChannelDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const rooms = channels.filter((c) => c.type !== 'dm');
  const dms = channels.filter((c) => c.type === 'dm');

  return (
    <nav className="sidebar">
      <div className="ws-name">Acme</div>
      <div className="side-h">Channels</div>
      {rooms.map((c) => (
        <button
          key={c.id}
          className={`side-item ${c.id === activeId ? 'active' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          # {c.name}
          {c.type === 'private' && <span className="lock" title="Private channel">🔒</span>}
        </button>
      ))}
      {dms.length > 0 && (
        <div className="side-h" title="Direct messages are never indexed by the AI">
          Direct messages 🔒
        </div>
      )}
      {dms.map((c) => (
        <button
          key={c.id}
          className={`side-item ${c.id === activeId ? 'active' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          {c.dmPartnerNames?.join(', ') || c.name}
        </button>
      ))}
      <div className="side-me">
        signed in as <b>{me.name}</b>
      </div>
    </nav>
  );
}
