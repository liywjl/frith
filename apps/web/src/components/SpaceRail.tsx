import { useEffect, useState } from 'react';
import type { SpaceListDto } from '@app/shared';
import { api } from '../lib/api';

/** Emoji for a space, from its name; falls back to the first letter. */
function spaceGlyph(name: string): string {
  const emoji = /\p{Extended_Pictographic}/u.exec(name)?.[0];
  return emoji ?? (name.trim()[0] ?? '?').toUpperCase();
}

/**
 * The far-left column: one icon per space on this device. Switching closes
 * the current space's log and opens the other — a different world, same app.
 */
export function SpaceRail({ onNewSpace, compact = false }: { onNewSpace?: () => void; compact?: boolean }) {
  const [list, setList] = useState<SpaceListDto | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    api.spaces().then(setList).catch(console.error);
  }, []);

  function switchTo(dir: string) {
    if (!list || dir === list.active || switching) return;
    setSwitching(dir); // ring moves instantly; the content area shows the load
    api
      .switchSpace(dir)
      // Everything — users, channels, session — belongs to the new space.
      .then(() => window.location.reload())
      .catch(() => setSwitching(null));
  }

  const activeDir = switching ?? list?.active;
  const switchingTo = list?.spaces.find((s) => s.dir === switching);

  return (
    <>
      <nav className={compact ? 'rail-compact' : 'rail'}>
        {(list?.spaces ?? []).map((s) => (
          <button
            key={s.dir}
            className={`rail-space ${s.dir === activeDir ? 'active' : ''}`}
            title={s.name}
            onClick={() => switchTo(s.dir)}
          >
            {spaceGlyph(s.name)}
          </button>
        ))}
        {onNewSpace && (
          <button className="rail-space rail-new" title="Create or join a space" onClick={onNewSpace}>
            +
          </button>
        )}
      </nav>
      {switchingTo && (
        <div className="switch-veil">
          <div className="switch-veil-card">
            <span className="switch-veil-glyph">{spaceGlyph(switchingTo.name)}</span>
            Opening {switchingTo.name}…
          </div>
        </div>
      )}
    </>
  );
}
