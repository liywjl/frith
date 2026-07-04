import type { ArtifactRef } from '@app/shared';

/** Chips for the code paths / links a set of messages keeps referencing. */
export function ArtifactChips({
  title,
  artifacts,
  onOpenChannel,
}: {
  title: string;
  artifacts: ArtifactRef[];
  onOpenChannel: (channelId: string) => void;
}) {
  if (artifacts.length === 0) return null;
  return (
    <section>
      <div className="home-h">{title}</div>
      <div className="profile-chips">
        {artifacts.map((a) => (
          <button
            key={a.ref}
            className="profile-chip"
            title={`Mentioned in #${a.channelName}`}
            onClick={() => onOpenChannel(a.channelId)}
          >
            {a.kind === 'link' ? '🔗' : '📄'} {a.ref} <small>×{a.mentions}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
