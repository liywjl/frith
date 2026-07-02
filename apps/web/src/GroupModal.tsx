import { useState } from 'react';
import type { UserDto } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

export function GroupModal({
  me,
  users,
  onCreated,
  onClose,
}: {
  me: UserDto;
  users: UserDto[];
  onCreated: (channelId: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const others = users.filter((u) => u.id !== me.id);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    setCreating(true);
    try {
      const { channelId } = await api.createGroup([...selected]);
      onCreated(channelId);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="New group conversation"
      subtitle="Pick at least two people — it stays private to the group."
      onClose={onClose}
    >
        <div className="group-list">
          {others.map((u) => (
            <label key={u.id} className="group-row">
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
              <Avatar name={u.name} emoji={u.avatarEmoji} />
              <span className="group-name">
                {u.name}
                {u.statusEmoji && <span className="status-emoji"> {u.statusEmoji}</span>}
              </span>
              <span className="group-title">{[u.title, u.team].filter(Boolean).join(' · ')}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={selected.size < 2 || creating} onClick={() => void create()}>
            {creating ? 'Creating…' : `Start group (${selected.size})`}
          </button>
        </div>
    </Modal>
  );
}
