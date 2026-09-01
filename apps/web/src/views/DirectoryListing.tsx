import { useEffect, useState } from 'react';
import type { SpaceDto } from '@app/shared';
import { api } from '../lib/api';

function listingFor(space: SpaceDto): string {
  return JSON.stringify(
    { name: space.name, description: space.description ?? '', tags: [], invite: space.invite ?? null },
    null,
    2,
  );
}

export function DirectoryListing() {
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.space().then(setSpace).catch(console.error);
  }, []);

  if (!space) return null;
  const listing = listingFor(space);
  return (
    <div className="feed-card dir-sample">
      <div className="feed-card-top">
        <b className="dir-name">These are sample communities</b>
      </div>
      <p className="feed-body">
        No public Frith directory exists yet, so the entries below show what one looks like. A directory is a JSON
        file on any static host; point Frith at it with FRITH_DIRECTORY_URL. To list your own space, add this entry
        to a directory feed:
      </p>
      <textarea className="space-desc" readOnly value={listing} onFocus={(e) => e.target.select()} />
      <div className="space-actions">
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(listing);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy entry'}
        </button>
      </div>
    </div>
  );
}
