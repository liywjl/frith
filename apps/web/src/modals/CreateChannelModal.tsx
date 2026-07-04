import { useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

export function CreateChannelModal({
  onCreated,
  onClose,
}: {
  onCreated: (channelId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const preview = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  async function create() {
    if (!preview) return;
    setCreating(true);
    setError(null);
    try {
      const { channelId } = await api.createChannel({
        name,
        type: isPrivate ? 'private' : 'public',
        topic: topic.trim() || null,
      });
      onCreated(channelId);
    } catch (e) {
      setError(e instanceof Error && e.message.includes('409') ? 'That name is taken.' : 'Could not create the channel.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="Create a channel"
      subtitle={
        isPrivate
          ? 'Private — only invited members can see it.'
          : 'Public — everyone can read it, and it feeds the knowledge index.'
      }
      onClose={onClose}
    >
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            placeholder="e.g. Project Phoenix"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          {preview && <span className="name-preview"># {preview}</span>}
        </label>

        <label className="field">
          <span>Topic (optional)</span>
          <input value={topic} placeholder="What is this channel about?" onChange={(e) => setTopic(e.target.value)} />
        </label>

        <label className="check-row">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Make private 🔒
        </label>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!preview || creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create channel'}
          </button>
        </div>
    </Modal>
  );
}
