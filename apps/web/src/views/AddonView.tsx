import { useState } from 'react';
import type { AddonDto } from '@app/shared';
import { api } from '../lib/api';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * A member-made tab, rendered by its template. Items are ops in the space's
 * log, so everyone sees the same list — this is the crew's shared surface.
 */
export function AddonView({ addon, onChanged }: { addon: AddonDto; onChanged: (a: AddonDto) => void }) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');

  async function add() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = await api.addAddonItem(addon.id, {
      text: trimmed,
      url: addon.kind === 'links' ? url.trim() || null : null,
    });
    onChanged(next);
    setText('');
    setUrl('');
  }

  const placeholder =
    addon.kind === 'checklist' ? 'Add something to do…' : addon.kind === 'links' ? 'What is this link?' : 'Write a note…';

  return (
    <div className="addon-view">
      <header className="view-head">
        <div>
          <h2>
            {addon.emoji} {addon.name}
          </h2>
          <p>
            {addon.kind} · made by {addon.createdByName} · shared with the whole space
          </p>
        </div>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm(`Remove the “${addon.name}” tab for everyone?`)) void api.removeAddon(addon.id);
          }}
        >
          Remove tab
        </button>
      </header>

      <div className="addon-items">
        {addon.items.map((item) =>
          addon.kind === 'checklist' ? (
            <label key={item.id} className={`addon-check ${item.done ? 'done' : ''}`}>
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) => void api.toggleAddonItem(addon.id, item.id, e.target.checked).then(onChanged)}
              />
              <span>{item.text}</span>
              <small>{item.authorName}</small>
            </label>
          ) : addon.kind === 'links' ? (
            <div key={item.id} className="addon-link">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.text}
                </a>
              ) : (
                <span>{item.text}</span>
              )}
              <small>
                {item.authorName} · {dateFormat.format(new Date(item.createdAt))}
              </small>
            </div>
          ) : (
            <div key={item.id} className="addon-note">
              <p>{item.text}</p>
              <small>
                {item.authorName} · {dateFormat.format(new Date(item.createdAt))}
              </small>
            </div>
          ),
        )}
        {addon.items.length === 0 && <p className="addon-empty">Nothing here yet — start it off below.</p>}
      </div>

      <div className="addon-composer">
        <input
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addon.kind !== 'links') void add();
          }}
        />
        {addon.kind === 'links' && (
          <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
        )}
        <button className="btn primary" onClick={() => void add()} disabled={!text.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
