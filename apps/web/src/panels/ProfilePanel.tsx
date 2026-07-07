import type { ChannelDto } from '@app/shared';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useProfile } from '../lib/useProfile';
import { useUserActions } from '../lib/userActions';

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * The right-hand companion to a DM: who you're talking to, at a glance —
 * their fun side, shared group chats, recent work, and the docs/code they
 * touch. Click-throughs everywhere; the full profile is one click away.
 */
export function ProfilePanel({
  userId,
  channels,
  online,
  onOpenChannel,
}: {
  userId: string;
  channels: ChannelDto[];
  online: Set<string>;
  onOpenChannel: (channelId: string) => void;
}) {
  const { openProfile, openTag } = useUserActions();
  const profile = useProfile(userId);

  if (!profile) return <aside className="profile-panel" />;
  const { user, recent, artifacts } = profile;

  const sharedGroups = channels.filter(
    (c) => c.type === 'dm' && (c.dmPartnerIds ?? []).length > 1 && (c.dmPartnerIds ?? []).includes(userId),
  );

  return (
    <aside className="profile-panel">
      <div className="panel-card panel-head panel-hero">
        <Avatar name={user.name} emoji={user.avatarEmoji} />
        <div className="panel-id">
          <b>
            {user.name} {user.statusEmoji && <span title={user.statusText ?? undefined}>{user.statusEmoji}</span>}
          </b>
          <span>{[user.title, user.team].filter(Boolean).join(' · ') || `@${user.handle}`}</span>
          <span className={`presence-inline ${online.has(userId) ? 'on' : ''}`}>
            {online.has(userId) ? 'online' : 'offline'}
          </span>
        </div>
        <button className="btn panel-full" onClick={() => openProfile(userId)}>
          Full profile
        </button>
      </div>

      {(user.nowPlaying || user.interests.length > 0) && (
        <div className="panel-card">
          <div className="panel-h">Off the clock</div>
          {user.nowPlaying && <div className="now-playing"><Icon name="headphones" /> {user.nowPlaying}</div>}
          {user.interests.length > 0 && (
            <div className="panel-tags">
              {user.interests.map((i) => (
                <button key={i} className="interest-chip" title={`See who else is into ${i}`} onClick={() => openTag(i)}>
                  {i}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sharedGroups.length > 0 && (
        <div className="panel-card">
          <div className="panel-h">Group chats together</div>
          {sharedGroups.map((g) => (
            <button key={g.id} className="panel-row" onClick={() => onOpenChannel(g.id)}>
              <span className="group-icon">{(g.dmPartnerIds ?? []).length + 1}</span>
              <span className="side-label">{g.dmPartnerNames?.join(', ')}</span>
            </button>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="panel-card">
          <div className="panel-h">Recent activity</div>
          {recent.slice(0, 3).map((m) => (
            <button key={m.id} className="panel-row panel-msg" onClick={() => onOpenChannel(m.channelId)}>
              <span className="panel-msg-body">{m.body}</span>
              <span className="home-when">{timeFormat.format(new Date(m.createdAt))}</span>
            </button>
          ))}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="panel-card">
          <div className="panel-h">Docs &amp; code they touch</div>
          <div className="panel-tags">
            {artifacts.slice(0, 4).map((a) => (
              <button
                key={a.ref}
                className="profile-chip"
                title={`Mentioned in #${a.channelName}`}
                onClick={() => onOpenChannel(a.channelId)}
              >
                <Icon name={a.kind === 'link' ? 'link' : 'doc'} /> {a.ref}
              </button>
            ))}
          </div>
        </div>
      )}

      {user.team && (
        <div className="panel-card">
          <div className="panel-h">Org</div>
          <button className="panel-row" onClick={() => openProfile(userId)}>
            <span className="side-label">Team {user.team} →</span>
          </button>
        </div>
      )}
    </aside>
  );
}
