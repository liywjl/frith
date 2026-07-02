import { useMemo, useState } from 'react';
import type { ChannelDto, UserDto } from '@app/shared';

type Item =
  | { kind: 'channel'; channel: ChannelDto; label: string }
  | { kind: 'user'; user: UserDto; label: string };

export function QuickSwitcher({
  me,
  channels,
  users,
  online,
  onSelectChannel,
  onSelectUser,
  onClose,
}: {
  me: UserDto;
  channels: ChannelDto[];
  users: UserDto[];
  online: Set<string>;
  onSelectChannel: (id: string) => void;
  onSelectUser: (userId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);

  const items = useMemo<Item[]>(() => {
    const channelItems: Item[] = channels.map((c) => ({
      kind: 'channel',
      channel: c,
      label: c.type === 'dm' ? (c.dmPartnerNames ?? []).join(', ') : c.name,
    }));
    // Unread first — ⌘K doubles as "what did I miss".
    channelItems.sort((a, b) => {
      const ua = a.kind === 'channel' ? a.channel.unreadCount : 0;
      const ub = b.kind === 'channel' ? b.channel.unreadCount : 0;
      if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    const dmPartnerIds = new Set(channels.flatMap((c) => c.dmPartnerIds ?? []));
    const userItems: Item[] = users
      .filter((u) => u.id !== me.id && !dmPartnerIds.has(u.id))
      .map((u) => ({ kind: 'user', user: u, label: u.name }));
    const all = [...channelItems, ...userItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.kind === 'user' && i.user.handle.toLowerCase().includes(q)),
    );
  }, [channels, users, me.id, query]);

  const clamped = Math.min(sel, Math.max(0, items.length - 1));

  function choose(item: Item) {
    if (item.kind === 'channel') onSelectChannel(item.channel.id);
    else onSelectUser(item.user.id);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Jump to a channel or person…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter' && items[clamped]) {
              choose(items[clamped]);
            }
          }}
        />
        <div className="switcher-list">
          {items.map((item, i) => (
            <button
              key={item.kind === 'channel' ? item.channel.id : item.user.id}
              className={`switcher-item ${i === clamped ? 'selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(item)}
            >
              <span className="switcher-icon">
                {item.kind === 'channel'
                  ? item.channel.type === 'public'
                    ? '#'
                    : item.channel.type === 'private'
                      ? '🔒'
                      : '@'
                  : '@'}
              </span>
              <span className="side-label">{item.label}</span>
              {item.kind === 'user' && (
                <span className={`presence ${online.has(item.user.id) ? 'on' : ''}`} />
              )}
              {item.kind === 'channel' && item.channel.unreadCount > 0 && (
                <span className="unread-badge">{item.channel.unreadCount}</span>
              )}
            </button>
          ))}
          {items.length === 0 && <div className="switcher-empty">Nothing matches “{query}”</div>}
        </div>
      </div>
    </div>
  );
}
