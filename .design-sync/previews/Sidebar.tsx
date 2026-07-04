import { Sidebar, UserActionsContext } from 'web';

const me = { id: 'me', name: 'Devon Iyer', title: 'Infra', team: 'Platform', avatarEmoji: '🛰️', statusEmoji: '☕', statusText: 'heads-down' };

const users = [
  { id: 'u1', name: 'Mara Okonkwo', title: 'P2P', team: 'Platform', avatarEmoji: '🦊', statusEmoji: '🔥', statusText: 'shipping' },
  { id: 'u2', name: 'Priya Nair', title: 'Design', team: 'Product', avatarEmoji: '🌿', statusEmoji: null, statusText: null },
  { id: 'u3', name: 'Sam Rivera', title: null, team: null, avatarEmoji: null, statusEmoji: null, statusText: null },
];

const channels = [
  { id: 'c1', name: 'infra', type: 'public', topic: null, archivedAt: null, pinned: 0, unreadCount: 3 },
  { id: 'c2', name: 'design', type: 'public', topic: null, archivedAt: null, pinned: null, unreadCount: 0 },
  { id: 'c3', name: 'founders', type: 'private', topic: null, archivedAt: null, pinned: null, unreadCount: 1 },
  { id: 'd1', name: 'dm', type: 'dm', topic: null, archivedAt: null, pinned: null, unreadCount: 0, dmPartnerIds: ['u1'], dmPartnerNames: ['Mara Okonkwo'] },
];

const noop = () => {};

// Sidebar reads openDm/openProfile from context.
const actions = {
  openDm: noop, openProfile: noop, openTag: noop,
  getUser: (id: string) => users.find((u) => u.id === id),
  isOnline: () => true,
};
const withActions = (node: React.ReactNode) => (
  <UserActionsContext.Provider value={actions}>{node}</UserActionsContext.Provider>
);

const common = {
  me,
  channels,
  users,
  onHome: noop, onTask: noop, onPeople: noop, onOpenSpace: noop, onSelect: noop,
  onNewGroup: noop, onNewChannel: noop, onTogglePin: noop, onReorderPins: noop,
};

export const Default = () =>
  withActions(
    <div style={{ height: 640, display: 'flex' }}>
      <Sidebar
        {...common}
        online={new Set(['u1', 'u2'])}
        activeId="c1"
        homeActive={false}
        taskActive={false}
        peopleActive={false}
        space={{ name: 'Lore HQ', invite: 'x', connectedPeers: 4 }}
        liveCalls={new Set(['c1'])}
      />
    </div>,
  );

export const HomeActive = () =>
  withActions(
    <div style={{ height: 640, display: 'flex' }}>
      <Sidebar
        {...common}
        online={new Set(['u1'])}
        activeId={null}
        homeActive
        taskActive={false}
        peopleActive={false}
        space={null}
        liveCalls={new Set()}
      />
    </div>,
  );
