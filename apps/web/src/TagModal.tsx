import type { UserDto } from '@app/shared';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { useUserActions } from './userActions';

/** Everyone in your network who shares an interest tag. */
export function TagModal({ tag, users, meId, onClose }: { tag: string; users: UserDto[]; meId: string; onClose: () => void }) {
  const { openDm, openProfile } = useUserActions();
  const fans = users.filter((u) => u.interests.some((i) => i.toLowerCase() === tag.toLowerCase()));

  return (
    <Modal title={`Into ${tag}`} subtitle={`${fans.length} ${fans.length === 1 ? 'person' : 'people'} in your network`} onClose={onClose}>
      <div className="group-list">
        {fans.map((u) => (
          <div key={u.id} className="people-row">
            <button
              className="people-who"
              onClick={() => {
                onClose();
                openProfile(u.id);
              }}
            >
              <Avatar name={u.name} emoji={u.avatarEmoji} />
              <span className="people-name">
                <b>{u.name}{u.id === meId ? ' (you)' : ''}</b>
                <small>{u.interests.join(', ')}</small>
              </span>
            </button>
            {u.id !== meId && (
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  openDm(u.id);
                }}
              >
                Message
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
