import { Message, UserActionsContext } from 'web';

// Message/UserHover read person actions from context; provide realistic ones
// so the static render (and any hover) has data instead of throwing.
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

const base = {
  id: 'm1',
  channelId: 'c1',
  authorId: 'u1',
  authorName: 'Mara Okonkwo',
  authorAvatarEmoji: '🦊',
  parentMessageId: null,
  body: 'Pushed the Autobase migration — replication survives a cold peer now. Can someone sanity-check middleware/session.ts before we cut the release?',
  createdAt: '2026-07-04T09:24:00.000Z',
  replyCount: 4,
  reactions: [
    { emoji: '🚀', count: 3, mine: true },
    { emoji: '👀', count: 1, mine: false },
  ],
  attachments: [],
};

// A colored placeholder rendered inline (no network) for the image variant.
const themeShot =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='420' height='200'><rect width='420' height='200' rx='10' fill='%230e7568'/><text x='24' y='110' fill='white' font-size='26' font-family='monospace'>Frith · theme refresh</text></svg>";

export const Default = () =>
  withActions(
    <div style={{ maxWidth: 660 }}>
      <Message message={base} onOpenThread={() => {}} />
    </div>,
  );

export const Conversation = () =>
  withActions(
    <div style={{ maxWidth: 660 }}>
      <Message message={base} onOpenThread={() => {}} />
      <Message
        message={{ ...base, id: 'm2', authorName: 'Devon Iyer', authorAvatarEmoji: '🛰️', body: 'Guard looks right — shipping.', reactions: [{ emoji: '✅', count: 2, mine: false }], replyCount: 0 }}
        compact
        onOpenThread={() => {}}
      />
    </div>,
  );

export const WithImage = () =>
  withActions(
    <div style={{ maxWidth: 660 }}>
      <Message
        message={{
          ...base,
          id: 'm3',
          body: 'New theme preview 👇',
          reactions: [],
          replyCount: 0,
          attachments: [{ id: 'a1', kind: 'image', name: 'theme.png', url: themeShot }],
        }}
        onOpenThread={() => {}}
      />
    </div>,
  );
