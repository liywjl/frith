import { useState } from 'react';
import type { AddonDto, AddonKind } from '@app/shared';
import { api } from '../lib/api';
import { Modal } from './Modal';

const TEMPLATES: { kind: AddonKind; emoji: string; title: string; pitch: string }[] = [
  { kind: 'checklist', emoji: '✅', title: 'Checklist', pitch: 'Plan an event, pack for a trip, track who does what.' },
  { kind: 'links', emoji: '🔗', title: 'Links board', pitch: 'Gear to buy, videos to watch, places to go.' },
  { kind: 'notes', emoji: '📝', title: 'Notes wall', pitch: 'Setlists, house rules, running jokes — a shared pinboard.' },
];

/**
 * "What should this tab help with?" — members shape their own space. The tab
 * becomes an op in the log, so the whole crew gets it.
 */
export function AddonModal({ onCreated, onClose }: { onCreated: (a: AddonDto) => void; onClose: () => void }) {
  const [kind, setKind] = useState<AddonKind>('checklist');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const template = TEMPLATES.find((t) => t.kind === kind)!;
      onCreated(await api.createAddon({ name: trimmed, emoji: emoji.trim() || template.emoji, kind }));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="Add a tab"
      subtitle="Your space, your interface — pick what this tab should help the crew do."
      onClose={onClose}
    >
      <div className="addon-templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.kind}
            className={`addon-template ${kind === t.kind ? 'active' : ''}`}
            onClick={() => setKind(t.kind)}
          >
            <span className="addon-template-emoji">{t.emoji}</span>
            <b>{t.title}</b>
            <small>{t.pitch}</small>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Name</span>
        <input
          autoFocus
          value={name}
          placeholder={kind === 'checklist' ? 'e.g. Summer jam prep' : kind === 'links' ? 'e.g. Gear wishlist' : 'e.g. Setlist ideas'}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
      </label>
      <label className="field">
        <span>Icon (optional emoji)</span>
        <input value={emoji} placeholder={TEMPLATES.find((t) => t.kind === kind)!.emoji} onChange={(e) => setEmoji(e.target.value)} />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void create()} disabled={creating || !name.trim()}>
          {creating ? 'Creating…' : 'Create tab'}
        </button>
      </div>
    </Modal>
  );
}
