import { useState } from 'react';
import { THEMES, type MeDto, type Theme } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';

const AVATAR_SUGGESTIONS = ['🦊', '🐙', '🌵', '🚀', '🍕', '🎸', '🧠', '🐝'];

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
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const user = await api.patchMe({
        name: form.name,
        title: form.title || null,
        team: form.team || null,
        avatarEmoji: form.avatarEmoji || null,
        statusEmoji: form.statusEmoji || null,
        statusText: form.statusText || null,
        theme: form.theme,
      });
      onSaved({ ...me, ...user, theme: form.theme });
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
        </div>

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
