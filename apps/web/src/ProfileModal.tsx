import { useState } from 'react';
import { THEMES, type MeDto, type Theme } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';

const AVATAR_SUGGESTIONS = ['🦊', '🐙', '🌵', '🚀', '🍕', '🎸', '🧠', '🐝'];

const STATUS_DURATIONS = [
  { label: "Don't clear", minutes: null },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 1440 },
] as const;

function expiryLabel(iso: string | null): string | null {
  if (!iso) return null;
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return null;
  return minutes < 60 ? `clears in ${minutes}m` : `clears in ${Math.round(minutes / 60)}h`;
}

const THEME_LABELS: Record<Theme, string> = {
  paper: 'Paper',
  midnight: 'Midnight',
  forest: 'Forest',
  sunset: 'Sunset',
};

export function ProfileModal({
  me,
  onSaved,
  onClose,
}: {
  me: MeDto;
  onSaved: (me: MeDto) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: me.name,
    title: me.title ?? '',
    team: me.team ?? '',
    avatarEmoji: me.avatarEmoji ?? '',
    statusEmoji: me.statusEmoji ?? '',
    statusText: me.statusText ?? '',
    theme: me.theme,
  });
  const [statusMinutes, setStatusMinutes] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const hasStatus = Boolean(form.statusEmoji || form.statusText);
      const user = await api.patchMe({
        name: form.name,
        title: form.title || null,
        team: form.team || null,
        avatarEmoji: form.avatarEmoji || null,
        statusEmoji: form.statusEmoji || null,
        statusText: form.statusText || null,
        statusExpiresInMinutes: hasStatus ? statusMinutes : null,
        theme: form.theme,
      });
      onSaved({
        ...me,
        ...user,
        theme: form.theme,
        statusExpiresAt:
          hasStatus && statusMinutes ? new Date(Date.now() + statusMinutes * 60_000).toISOString() : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Avatar name={form.name || me.name} emoji={form.avatarEmoji || null} />
          <div>
            <div className="modal-title">Your profile</div>
            <div className="modal-sub">@{me.handle}</div>
          </div>
        </div>

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
          <span>Avatar emoji</span>
          <div className="emoji-row">
            <input
              className="emoji-input"
              value={form.avatarEmoji}
              placeholder="🙂"
              onChange={(e) => set('avatarEmoji')(e.target.value)}
            />
            {AVATAR_SUGGESTIONS.map((e) => (
              <button key={e} className="emoji-pick" onClick={() => set('avatarEmoji')(e)}>
                {e}
              </button>
            ))}
          </div>
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

        <div className="field">
          <span>Theme</span>
          <div className="theme-row">
            {THEMES.map((t) => (
              <button
                key={t}
                className={`theme-swatch theme-${t} ${form.theme === t ? 'selected' : ''}`}
                onClick={() => setForm((f) => ({ ...f, theme: t }))}
              >
                <span className="theme-dot" />
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || !form.name.trim()} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
