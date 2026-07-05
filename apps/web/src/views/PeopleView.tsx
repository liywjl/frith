import type { MeDto, SpaceDto, UserDto } from '@app/shared';
import { Avatar } from '../components/Avatar';
import { useUserActions } from '../lib/userActions';

/** Your network: everyone in the workspace, who's online, who's blocked. */
export function PeopleView({
  me,
  users,
  online,
  space,
  onToggleBlock,
  onInvite,
}: {
  me: MeDto;
  users: UserDto[];
  online: Set<string>;
  space: SpaceDto | null;
  onToggleBlock: (userId: string, blocked: boolean) => void;
  onInvite: () => void;
}) {
  const { openDm, openProfile, openTag } = useUserActions();
  const blocked = users.filter((u) => me.blockedUserIds.includes(u.id));
  const everyone = users.filter((u) => u.id !== me.id && !me.blockedUserIds.includes(u.id));

  function Row({ u, isBlocked }: { u: UserDto; isBlocked?: boolean }) {
    return (
      <div className="people-row">
        <button className="people-who" onClick={() => openProfile(u.id)}>
          <Avatar name={u.name} emoji={u.avatarEmoji} />
          <span className="people-name">
            <b>
              {u.name} {u.statusEmoji && <span title={u.statusText ?? undefined}>{u.statusEmoji}</span>}
            </b>
            <small>{[u.title, u.team].filter(Boolean).join(' · ')}</small>
          </span>
        </button>
        <span className={`presence-inline ${online.has(u.id) ? 'on' : ''}`}>
          {online.has(u.id) ? 'online' : ''}
        </span>
        <span className="people-tags">
          {u.interests.slice(0, 3).map((i) => (
            <button key={i} className="tag-mini" onClick={() => openTag(i)}>
              {i}
            </button>
          ))}
        </span>
        <span className="people-actions">
          {!isBlocked && (
            <button className="btn" onClick={() => openDm(u.id)}>
              Message
            </button>
          )}
          <button className={`btn ${isBlocked ? '' : 'block-btn'}`} onClick={() => onToggleBlock(u.id, !isBlocked)}>
            {isBlocked ? 'Unblock' : 'Block'}
          </button>
        </span>
      </div>
    );
  }

  return (
    <main className="main home">
      <div className="home-scroll">
        <header className="home-head people-head">
          <div>
            <h1>People</h1>
            <p>
              {everyone.length + 1} in this space · {online.size} online
              {space && ` · ${space.connectedPeers} peer instance${space.connectedPeers === 1 ? '' : 's'} connected`}
              {blocked.length > 0 && ` · ${blocked.length} blocked`}
            </p>
            <p className="people-trust">
              Everyone here joined with this space's invite — devices connect directly, no server in between.
            </p>
          </div>
          <button className="btn primary" onClick={onInvite}>
            ✉️ Invite someone
          </button>
        </header>
        <section>
          {everyone.map((u) => (
            <Row key={u.id} u={u} />
          ))}
        </section>
        {blocked.length > 0 && (
          <section>
            <div className="home-h">Blocked</div>
            {blocked.map((u) => (
              <Row key={u.id} u={u} isBlocked />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
