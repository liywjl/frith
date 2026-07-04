import { ThreadCard } from 'web';

export const Default = () => (
  <div style={{ maxWidth: 440, display: 'grid', gap: 10 }}>
    <ThreadCard channelName="infra" corner={<span className="home-when">2h ago</span>} onClick={() => {}}>
      <div>Migrating replication to Autobase — survives a cold peer now. 12 replies.</div>
    </ThreadCard>
    <ThreadCard channelName="design" corner={<span className="home-when">yesterday</span>} onClick={() => {}}>
      <div>New campfire logo + theme refresh shipped 🎉</div>
    </ThreadCard>
  </div>
);

export const WithCornerCount = () => (
  <div style={{ maxWidth: 440 }}>
    <ThreadCard channelName="founders" corner={<span className="unread-badge">3</span>} onClick={() => {}}>
      <div>Q3 roadmap: sovereignty story + on-device AI queries.</div>
    </ThreadCard>
  </div>
);
