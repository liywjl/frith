import { useEffect, useState } from 'react';
import type { SpaceListDto } from '@app/shared';
import { api } from '../lib/api';
import { isPlaceholderSpace } from '../lib/spaces';

export function DeviceSpaces() {
  const [list, setList] = useState<SpaceListDto | null>(null);

  useEffect(() => {
    api.spaces().then(setList).catch(console.error);
  }, []);

  const spaces = (list?.spaces ?? []).filter((s) => !isPlaceholderSpace(s));
  if (spaces.length === 0) return null;

  function remove(dir: string, name: string) {
    if (!window.confirm(`Remove "${name}" from this device? Its messages and files here will be deleted.`)) return;
    void api.removeSpaceDir(dir).then(() => window.location.reload());
  }

  return (
    <section className="device-spaces">
      <div className="login-list-h">Spaces on this device</div>
      <p className="space-hint">
        Removing a space deletes only this device's copy. An invite brings you back, and what you can read after
        rejoining follows that space's history setting.
      </p>
      {spaces.map((s) => (
        <div key={s.dir} className="member-row">
          <span className="member-name">
            {s.name} {s.dir === list?.active && <small>(open)</small>}
          </span>
          <button className="btn danger" onClick={() => remove(s.dir, s.name)}>
            Remove
          </button>
        </div>
      ))}
    </section>
  );
}
