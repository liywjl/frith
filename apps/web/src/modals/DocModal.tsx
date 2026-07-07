import { useState } from 'react';
import type { DocFullDto } from '@app/shared';
import { api } from '../lib/api';
import { Modal } from './Modal';

/** Name a new shared doc — it becomes an op in the log, a page for the whole
 *  space. Writing happens in the doc itself. */
export function DocModal({ onCreated, onClose }: { onCreated: (doc: DocFullDto) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      onCreated(await api.createDoc(trimmed));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="New doc"
      subtitle="A shared page for the whole space — agendas, decisions, runbooks."
      onClose={onClose}
    >
      <label className="field">
        <span>Title</span>
        <input
          autoFocus
          value={title}
          placeholder="e.g. Launch checklist"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void create()} disabled={creating || !title.trim()}>
          {creating ? 'Creating…' : 'Create doc'}
        </button>
      </div>
    </Modal>
  );
}
