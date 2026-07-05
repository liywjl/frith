import { useEffect, useState } from 'react';
import type { ChannelDto, UserDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { Modal } from './Modal';

/**
 * Who's in a private channel or group — and the controls to change that.
 * Any member can bring someone in or remove them; removing yourself is
 * leaving. Membership syncs to every peer like any other op.
 */
export function MembersModal({
  channel,
  meId,
  onLeft,
  onClose,
}: {
  channel: ChannelDto;
  meId: string;
  /** Called after you remove yourself — the channel is gone for you. */
  onLeft: () => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<UserDto[]>([]);
  const [everyone, setEveryone] = useState<UserDto[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.channelMembers(channel.id).then(setMembers).catch(console.error);
    api.users().then(setEveryone).catch(console.error);
  }, [channel.id]);

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = everyone.filter((u) => !memberIds.has(u.id));
  const label = channel.type === 'dm' ? 'this conversation' : `#${channel.name}`;

  async function remove(userId: string) {
    const next = await api.removeChannelMember(channel.id, userId);
    if (userId === meId) return onLeft();
    setMembers(next);
  }

  return (
    <Modal
      title={channel.type === 'dm' ? 'People in this conversation' : `Members of #${channel.name}`}
      subtitle="Only these people can read it — membership syncs to every device in the space."
      onClose={onClose}
    >
      {members.map((u) => (
        <div key={u.id} className="member-row">
          <Avatar name={u.name} emoji={u.avatarEmoji} />
          <span className="member-name">
            {u.name} {u.id === meId && <small>(you)</small>}
          </span>
          <button
            className="btn"
            onClick={() => {
              if (u.id !== meId || window.confirm(`Leave ${label}? You'll lose access until someone adds you back.`))
                void remove(u.id);
            }}
          >
            {u.id === meId ? 'Leave' : 'Remove'}
          </button>
        </div>
      ))}

      {adding ? (
        <div className="member-add-list">
          {candidates.map((u) => (
            <button
              key={u.id}
              className="member-row member-add"
              onClick={() => void api.addChannelMember(channel.id, u.id).then(setMembers)}
            >
              <Avatar name={u.name} emoji={u.avatarEmoji} />
              <span className="member-name">{u.name}</span>
              <span className="member-plus">+ add</span>
            </button>
          ))}
          {candidates.length === 0 && <p className="library-empty">Everyone in the space is already here.</p>}
        </div>
      ) : (
        <div className="modal-actions">
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Add people
          </button>
        </div>
      )}
    </Modal>
  );
}
