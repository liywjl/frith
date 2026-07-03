import type { MeDto } from '@app/shared';
import { Avatar } from './Avatar';
import { useProfile } from './useProfile';
import { useUserActions } from './userActions';
import { ArtifactChips } from './ArtifactChips';

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ProfileView({
  userId,
  me,
  online,
  onOpenDm,
  onOpenChannel,
  onEditProfile,
  onToggleBlock,
}: {
  userId: string;
  me: MeDto;
  online: Set<string>;
  onOpenDm: (userId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onEditProfile: () => void;
  onToggleBlock: (userId: string, blocked: boolean) => void;
}) {
  const { openProfile, openTag } = useUserActions();
  const profile = useProfile(userId);

  if (!profile) return <main className="main profile" />;
  const { user, stats, topChannels, teammates, popular, artifacts, recent } = profile;
  const isMe = user.id === me.id;

  return (
    <main className="main profile">
      <div className="home-scroll">
        <header className="profile-head">
          <div className="profile-avatar">
            <Avatar name={user.name} emoji={user.avatarEmoji} />
          </div>
          <div className="profile-id">
            <h1>
              {user.name}
              {user.statusEmoji && (
                <span className="profile-status" title={user.statusText ?? undefined}>
                  {' '}
                  {user.statusEmoji} <small>{user.statusText}</small>
                </span>
              )}
            </h1>
            <p>
              @{user.handle}
              {(user.title || user.team) && ` · ${[user.title, user.team].filter(Boolean).join(' · ')}`}
              {' · '}
              <span className={`presence-inline ${online.has(user.id) ? 'on' : ''}`}>
                {online.has(user.id) ? 'online' : 'offline'}
              </span>
            </p>
          </div>
          {isMe ? (
            <button className="btn" onClick={onEditProfile}>
              Edit profile
            </button>
          ) : me.blockedUserIds.includes(user.id) ? (
            <button className="btn" onClick={() => onToggleBlock(user.id, false)}>
              Unblock
            </button>
          ) : (
            <>
              <button className="btn primary" onClick={() => onOpenDm(user.id)}>
                Message
              </button>
              <button
                className="btn block-btn"
                title="Hide this person's messages everywhere and stop DMs both ways"
                onClick={() => onToggleBlock(user.id, true)}
              >
                Block
              </button>
            </>
          )}
        </header>
        {me.blockedUserIds.includes(user.id) && (
          <p className="profile-privacy">
            You've blocked {user.name.split(' ')[0]} — their messages are hidden everywhere and neither of you
            can start a DM. Unblock any time.
          </p>
        )}

        {(user.nowPlaying || user.interests.length > 0) && (
          <section className="beyond-work">
            {user.nowPlaying && <div className="now-playing">🎧 {user.nowPlaying}</div>}
            {user.interests.length > 0 && (
              <div className="profile-chips">
                {user.interests.map((i) => (
                  <button key={i} className="interest-chip" title={`See who else is into ${i}`} onClick={() => openTag(i)}>
                    {i}
                    {me.id !== user.id && me.interests.some((m) => m.toLowerCase() === i.toLowerCase()) && (
                      <small> · you too</small>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="profile-stats">
          <div>
            <b>{stats.messages}</b>
            <span>messages</span>
          </div>
          <div>
            <b>{stats.channelsActive}</b>
            <span>channels active</span>
          </div>
          <div>
            <b>{stats.reactionsReceived}</b>
            <span>reactions received</span>
          </div>
        </section>

        {teammates.length > 1 && (
          <section>
            <div className="home-h">Team {user.team}</div>
            <div className="org-chart">
              {teammates.map((t) => (
                <button
                  key={t.id}
                  className={`org-node ${t.id === user.id ? 'current' : ''}`}
                  onClick={() => openProfile(t.id)}
                >
                  <Avatar name={t.name} emoji={t.avatarEmoji} />
                  <b>{t.name.split(' ')[0]}</b>
                  <small>{t.title ?? ''}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {topChannels.length > 0 && (
          <section>
            <div className="home-h">Works in</div>
            <div className="profile-chips">
              {topChannels.map((c) => (
                <button key={c.id} className="profile-chip" onClick={() => onOpenChannel(c.id)}>
                  # {c.name} <small>{c.count}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        <ArtifactChips title="Code & docs they touch" artifacts={artifacts} onOpenChannel={onOpenChannel} />

        {popular.length > 0 && (
          <section>
            <div className="home-h">Most useful posts</div>
            {popular.map((m) => (
              <button key={m.id} className="home-card" onClick={() => onOpenChannel(m.channelId)}>
                <span className="home-card-top">
                  <span className="home-engagement">
                    {m.reactions.length > 0 && (
                      <span>{m.reactions.map((r) => `${r.emoji} ${r.count}`).join('  ')}</span>
                    )}
                    {m.replyCount > 0 && <span>↳ {m.replyCount} replies</span>}
                  </span>
                  <span className="home-when">{timeFormat.format(new Date(m.createdAt))}</span>
                </span>
                <span className="home-snippet">{m.body}</span>
              </button>
            ))}
          </section>
        )}

        <section>
          <div className="home-h">Recent activity</div>
          {recent.length === 0 && <div className="ask-none">Nothing you can see yet.</div>}
          <div className="profile-recent">
            {recent.map((m) => (
              <button key={m.id} className="home-card" onClick={() => onOpenChannel(m.channelId)}>
                <span className="home-card-top">
                  <b>{m.replyCount > 0 ? `↳ thread · ${m.replyCount} replies` : 'message'}</b>
                  <span className="home-when">{timeFormat.format(new Date(m.createdAt))}</span>
                </span>
                <span className="home-snippet">{m.body}</span>
              </button>
            ))}
          </div>
          <p className="profile-privacy">Profiles only show activity from channels you can read — never direct messages.</p>
        </section>
      </div>
    </main>
  );
}
