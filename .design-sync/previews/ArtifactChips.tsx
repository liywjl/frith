import { ArtifactChips } from 'web';

const artifacts = [
  { ref: 'server/api/realtime.ts', kind: 'code', mentions: 7, channelId: 'c1', channelName: 'infra' },
  { ref: 'linear.app/lore/TICK-482', kind: 'link', mentions: 3, channelId: 'c2', channelName: 'triage' },
  { ref: 'domain/scheduler.ts', kind: 'code', mentions: 5, channelId: 'c1', channelName: 'infra' },
  { ref: 'DESIGN.md', kind: 'code', mentions: 2, channelId: 'c3', channelName: 'design' },
];

export const Default = () => (
  <div style={{ maxWidth: 480 }}>
    <ArtifactChips
      title="Code & links this task keeps citing"
      artifacts={artifacts}
      onOpenChannel={() => {}}
    />
  </div>
);

export const SingleLink = () => (
  <div style={{ maxWidth: 480 }}>
    <ArtifactChips
      title="Referenced once"
      artifacts={[{ ref: 'github.com/lore/pears#42', kind: 'link', mentions: 1, channelId: 'c4', channelName: 'p2p' }]}
      onOpenChannel={() => {}}
    />
  </div>
);
