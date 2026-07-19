// The community directory: public spaces broadcasting what they're about.
// The list comes from a directory feed the server fetches (anyone can host
// one — see DESIGN.md); entries are display + an invite you choose to use.
import { useEffect, useMemo, useState } from 'react';
import type { DirectoryDto, DirectoryEntryDto } from '@app/shared';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';

function JoinButton({ entry }: { entry: DirectoryEntryDto }) {
  const [state, setState] = useState<'idle' | 'joining' | 'failed'>('idle');

  if (!entry.invite) {
    return (
      <span className="dir-host" title="This community hands out invites itself — reach out to its host.">
        ask {entry.host ?? 'the host'}
      </span>
    );
  }
  return (
    <button
      className="btn primary"
      disabled={state === 'joining'}
      title="Joining adds this space to your rail — it syncs peer-to-peer from its members."
      onClick={() => {
        setState('joining');
        api
          .joinSpace(entry.invite!)
          .then(() => window.location.reload())
          .catch(() => setState('failed'));
      }}
    >
      {state === 'joining' ? 'Joining…' : state === 'failed' ? 'Invite didn’t work' : 'Join'}
    </button>
  );
}

export function DirectoryView() {
  const [dir, setDir] = useState<DirectoryDto | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.directory().then(setDir).catch(console.error);
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!dir) return [];
    if (!q) return dir.entries;
    return dir.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [dir, filter]);

  return (
    <main className="main directory">
      <div className="home-scroll feed-scroll">
        <header className="home-head">
          <h1>Directory</h1>
          <p>
            Public communities broadcasting what they're into — anyone can join, and anyone can host a
            directory. Each space still syncs peer-to-peer between its own members.
          </p>
          <input
            className="files-filter"
            placeholder="Search by name or interest…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </header>

        {dir?.error && (
          <p className="profile-privacy">
            Couldn't reach the configured directory ({dir.error}) — showing nothing rather than something stale.
          </p>
        )}

        {shown.map((e) => (
          <div key={e.name} className="feed-card dir-card">
            <div className="feed-card-top">
              <b className="dir-name">{e.name}</b>
              {typeof e.members === 'number' && <span className="dir-members">{e.members} members</span>}
              <span className="dir-join">
                <JoinButton entry={e} />
              </span>
            </div>
            {e.description && <p className="feed-body">{e.description}</p>}
            <div className="profile-chips">
              {e.tags.map((t) => (
                <span key={t} className="interest-chip dir-tag">
                  {t}
                </span>
              ))}
              {e.host && (
                <span className="dir-host" title="Who runs the always-on seeder for this community">
                  <Icon name="globe" /> {e.host}
                </span>
              )}
            </div>
          </div>
        ))}

        {dir && shown.length === 0 && !dir.error && (
          <div className="home-empty">
            {dir.entries.length === 0 ? 'This directory is empty.' : 'No community matches that search.'}
          </div>
        )}

        <p className="profile-privacy">
          The directory is a feed this app fetches — it never sees your spaces, your messages, or who you are.
          Hosting your own is a JSON file on any static host (set FRITH_DIRECTORY_URL).
        </p>
      </div>
    </main>
  );
}
