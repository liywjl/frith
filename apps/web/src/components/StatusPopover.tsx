import { useState } from 'react';
import type { MeDto } from '@app/shared';
import { api } from '../lib/api';
import { useEscape } from '../modals/Modal';

/** One-click status presets + a custom field. Opens straight from the
 *  bottom-left identity button so setting a status isn't a trip to the profile. */
const PRESETS = [
  { emoji: '🗓️', text: 'In a meeting', minutes: 60 },
  { emoji: '🎯', text: 'Focusing', minutes: 240 },
  { emoji: '☕', text: 'Coffee break', minutes: 30 },
  { emoji: '🍽️', text: 'Out for lunch', minutes: 60 },
  { emoji: '🤒', text: 'Out sick', minutes: 1440 },
  { emoji: '🏝️', text: 'On holiday', minutes: null },
] as const;

const DURATIONS = [
  { label: "Don't clear", minutes: null },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Today', minutes: 1440 },
] as const;

export function StatusPopover({
  me,
  anchor,
  onSaved,
  onClose,
  onViewProfile,
}: {
  me: MeDto;
  anchor: { left: number; top: number };
  onSaved: (me: MeDto) => void;
  onClose: () => void;
  onViewProfile: () => void;
}) {
  const [emoji, setEmoji] = useState(me.statusEmoji ?? '');
  const [text, setText] = useState(me.statusText ?? '');
  const [minutes, setMinutes] = useState<number | null>(60);
  const hasStatus = !!(me.statusEmoji || me.statusText);

  useEscape(onClose);

  function apply(e: string | null, t: string | null, mins: number | null) {
    void api
      .patchMe({ statusEmoji: e, statusText: t, statusExpiresInMinutes: e || t ? mins : null })
      .then((u) => onSaved({ ...me, ...u }));
    onClose();
  }

  return (
    <>
      <div className="status-pop-backdrop" onClick={onClose} />
      <div
        className="status-pop"
        style={{ left: anchor.left, bottom: window.innerHeight - anchor.top + 6 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="status-pop-h">Set a status</div>
        <div className="status-presets">
          {PRESETS.map((p) => (
            <button key={p.text} className="status-preset" onClick={() => apply(p.emoji, p.text, p.minutes)}>
              <span>{p.emoji}</span> {p.text}
            </button>
          ))}
        </div>
        <div className="status-custom">
          <input
            className="status-emoji"
            value={emoji}
            placeholder="😀"
            onChange={(e) => setEmoji(e.target.value)}
          />
          <input
            className="status-text"
            value={text}
            placeholder="What's your status?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (emoji || text)) apply(emoji || null, text || null, minutes);
            }}
          />
        </div>
        <div className="status-custom-row">
          <select
            value={minutes ?? ''}
            onChange={(e) => setMinutes(e.target.value === '' ? null : Number(e.target.value))}
          >
            {DURATIONS.map((d) => (
              <option key={d.label} value={d.minutes ?? ''}>
                {d.label}
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={() => apply(emoji || null, text || null, minutes)} disabled={!emoji && !text}>
            Save
          </button>
        </div>
        <div className="status-pop-foot">
          {hasStatus ? (
            <button className="status-clear-link" onClick={() => apply(null, null, null)}>
              Clear status
            </button>
          ) : (
            <span />
          )}
          <button
            className="status-profile-link"
            onClick={() => {
              onClose();
              onViewProfile();
            }}
          >
            View profile
          </button>
        </div>
      </div>
    </>
  );
}
