import { UserHover, Avatar, UserActionsContext } from 'web';

// UserHover reads person actions from context; the hover card itself is
// interaction-driven, so the static preview shows the trigger element.
const actions = {
  openDm: () => {},
  openProfile: () => {},
  openTag: () => {},
  getUser: (id: string) => ({ id, handle: 'mara', name: 'Mara Okonkwo', title: 'P2P', team: 'Platform', avatarEmoji: '🦊', statusEmoji: '🔥', statusText: 'shipping', interests: ['rust', 'trail running'], nowPlaying: 'lofi beats' }),
  isOnline: () => true,
};
const withActions = (node: React.ReactNode) => (
  <UserActionsContext.Provider value={actions}>{node}</UserActionsContext.Provider>
);

export const Default = () =>
  withActions(
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
      <UserHover userId="u1" name="Mara Okonkwo">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <Avatar name="Mara Okonkwo" emoji="🦊" />
          <b>Mara Okonkwo</b>
        </span>
      </UserHover>
      <span style={{ color: 'var(--ink-soft)' }}>← hover reveals a one-click profile card</span>
    </div>,
  );

export const InlineName = () =>
  withActions(
    <div style={{ fontSize: 14, lineHeight: 1.7, maxWidth: 460 }}>
      Ping{' '}
      <UserHover userId="u2" name="Priya Nair">
        <b className="who-link" style={{ cursor: 'pointer' }}>Priya Nair</b>
      </UserHover>{' '}
      when the theme tokens land — she owns the design pass.
    </div>,
  );
