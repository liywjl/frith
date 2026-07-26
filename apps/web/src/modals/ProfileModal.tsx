import { useEffect, useRef, useState } from 'react';
import { THEMES, type MeDto, type ProfileLink, type ProfilePatch, type Theme } from '@app/shared';
import { api } from '../lib/api';
import { applyPalette } from '../lib/palette';
import { Avatar } from '../components/Avatar';
import { Modal } from './Modal';

const STATUS_DURATIONS = [
  { label: "Don't clear", minutes: null },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 1440 },
] as const;

/** Profile accent presets — the same family the seed corpora use. */
const ACCENTS = ['#e8590c', '#d6336c', '#c2255c', '#7048e8', '#6741d9', '#1971c2', '#0c8599', '#2f9e44'];

const THEME_LABELS: Record<Theme, string> = {
  ocean: 'Ocean',
  bubbly: 'Bubbly',
  paper: 'Paper',
  midnight: 'Midnight',
  forest: 'Forest',
  sunset: 'Sunset',
  mono: 'Mono',
};

function expiryLabel(iso: string | null): string | null {
  if (!iso) return null;
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return null;
  return minutes < 60 ? `clears in ${minutes}m` : `clears in ${Math.round(minutes / 60)}h`;
}

function toForm(me: MeDto) {
  return {
    name: me.name,
    title: me.title ?? '',
    team: me.team ?? '',
    avatarEmoji: me.avatarEmoji ?? '',
    statusEmoji: me.statusEmoji ?? '',
    statusText: me.statusText ?? '',
    interests: me.interests.join(', '),
    nowPlaying: me.nowPlaying ?? '',
    bio: me.bio ?? '',
    accentColor: me.accentColor ?? '',
    links: me.links,
    location: me.location ?? '',
    theme: me.theme,
  };
}

function toPatch(form: ReturnType<typeof toForm>, statusMinutes: number | null): ProfilePatch {
  return {
    name: form.name.trim() || undefined,
    title: form.title || null,
    team: form.team || null,
    avatarEmoji: form.avatarEmoji || null,
    statusEmoji: form.statusEmoji || null,
    statusText: form.statusText || null,
    statusExpiresInMinutes: form.statusEmoji || form.statusText ? statusMinutes : null,
    interests: form.interests
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean)
      .slice(0, 12),
    nowPlaying: form.nowPlaying || null,
    bio: form.bio.trim() || null,
    accentColor: form.accentColor || null,
    location: form.location.trim() || null,
    // Half-typed rows stay local until they're a real link — the server
    // (rightly) rejects anything that isn't an http(s) URL.
    links: form.links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label && /^https?:\/\/\S+\.\S+/.test(l.url))
      .slice(0, 8),
    theme: form.theme,
  };
}

/**
 * Edits apply as you type (debounced) — no Save button. Cancel puts
 * everything back the way it was when you opened the modal.
 */
export function ProfileModal({
  me,
  onSaved,
  onClose,
}: {
  me: MeDto;
  onSaved: (me: MeDto) => void;
  onClose: () => void;
}) {
  const snapshot = useRef(toForm(me));
  const snapshotMe = useRef(me);
  const [form, setForm] = useState(toForm(me));
  const [statusMinutes, setStatusMinutes] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const first = useRef(true);

  const set = (key: keyof ReturnType<typeof toForm>) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Autosave: any change lands ~600ms after you stop typing.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void api.patchMe(toPatch(form, statusMinutes)).then((user) => {
        onSaved({ ...snapshotMe.current, ...user, theme: form.theme, statusExpiresAt: null });
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [form, statusMinutes]);

  function cancel() {
    document.documentElement.dataset.theme = snapshot.current.theme;
    void api
      .patchMe(toPatch(snapshot.current, null))
      .then((user) => onSaved({ ...snapshotMe.current, ...user, theme: snapshot.current.theme }));
    onClose();
  }

  return (
    <Modal
      title="Your profile"
      subtitle={
        <>
          @{me.handle} · edits save automatically{' '}
          {saved && <span className="saved-flash">saved ✓</span>}
        </>
      }
      headExtra={<Avatar name={form.name || me.name} emoji={form.avatarEmoji || null} />}
      onClose={onClose}
    >
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Title</span>
            <input value={form.title} placeholder="e.g. Software Engineer" onChange={(e) => set('title')(e.target.value)} />
          </label>
          <label className="field">
            <span>Team</span>
            <input value={form.team} placeholder="e.g. Payments" onChange={(e) => set('team')(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Location — city, country, van, wherever</span>
          <input
            value={form.location}
            placeholder="e.g. Oslo, Norway"
            onChange={(e) => set('location')(e.target.value)}
          />
        </label>

        <div className="field-row">
          <label className="field emoji-field">
            <span>Status</span>
            <input
              className="emoji-input"
              value={form.statusEmoji}
              placeholder="☕"
              onChange={(e) => set('statusEmoji')(e.target.value)}
            />
          </label>
          <label className="field grow">
            <span>&nbsp;</span>
            <input
              value={form.statusText}
              placeholder="What are you up to?"
              onChange={(e) => set('statusText')(e.target.value)}
            />
          </label>
          <label className="field status-clear">
            <span>Clear after</span>
            <select
              value={statusMinutes ?? ''}
              onChange={(e) => setStatusMinutes(e.target.value === '' ? null : Number(e.target.value))}
            >
              {STATUS_DURATIONS.map((d) => (
                <option key={d.label} value={d.minutes ?? ''}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {expiryLabel(me.statusExpiresAt) && (
          <div className="status-expiry-hint">Current status {expiryLabel(me.statusExpiresAt)}</div>
        )}

        <label className="field">
          <span>Into (comma-separated — shared with everyone, used to suggest connections)</span>
          <input
            value={form.interests}
            placeholder="e.g. dogs, rollerblading, synthwave"
            onChange={(e) => set('interests')(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Currently enjoying 🎧</span>
          <input
            value={form.nowPlaying}
            placeholder="music, a series, a film, a rabbit hole…"
            onChange={(e) => set('nowPlaying')(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Bio — a couple of lines about you, shown on your profile</span>
          <textarea
            rows={3}
            maxLength={400}
            value={form.bio}
            placeholder="who you are, what you're about…"
            onChange={(e) => set('bio')(e.target.value)}
          />
        </label>

        <div className="field">
          <span>Links — your blog, socials, anywhere you live online</span>
          {form.links.map((l, i) => (
            <div className="link-row" key={i}>
              <input
                className="link-label"
                value={l.label}
                placeholder="Label"
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    links: f.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  }))
                }
              />
              <input
                className="link-url"
                value={l.url}
                placeholder="https://…"
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    links: f.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                  }))
                }
              />
              <button
                className="btn link-remove"
                title="Remove link"
                aria-label="Remove link"
                onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }))}
              >
                ✕
              </button>
            </div>
          ))}
          {form.links.length < 8 && (
            <button
              className="btn link-add"
              onClick={() => setForm((f) => ({ ...f, links: [...f.links, { label: '', url: '' } as ProfileLink] }))}
            >
              + Add a link
            </button>
          )}
        </div>

        <div className="field">
          <span>Profile accent — tints your profile page</span>
          <div className="accent-list">
            <button
              className={`accent-swatch accent-none ${form.accentColor === '' ? 'selected' : ''}`}
              title="No accent"
              onClick={() => setForm((f) => ({ ...f, accentColor: '' }))}
            >
              ✕
            </button>
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={`accent-swatch ${form.accentColor === c ? 'selected' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={`Accent ${c}`}
                onClick={() => setForm((f) => ({ ...f, accentColor: c }))}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span>Theme — applies as you click</span>
          <div className="theme-list">
            {THEMES.map((t) => (
              <button
                key={t}
                className={`theme-option ${form.theme === t ? 'selected' : ''}`}
                onClick={() => {
                  applyPalette(null); // drop any leftover palette override so the theme actually shows
                  document.documentElement.dataset.theme = t;
                  setForm((f) => ({ ...f, theme: t }));
                }}
              >
                <span className="theme-option-name">{THEME_LABELS[t]}</span>
                {/* Live strip: data-theme re-scopes the CSS vars to this theme. */}
                <span className="theme-strip" data-theme={t}>
                  <span style={{ background: 'var(--rail)' }} />
                  <span style={{ background: 'var(--side)' }} />
                  <span style={{ background: 'var(--paper)' }} />
                  <span style={{ background: 'var(--ai)' }} />
                  <span style={{ background: 'var(--ink)' }} />
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button
            className="btn logout-btn"
            onClick={() => void api.logout().then(() => window.location.reload())}
          >
            Log out
          </button>
          <button className="btn" onClick={cancel}>
            Cancel &amp; revert
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
    </Modal>
  );
}
