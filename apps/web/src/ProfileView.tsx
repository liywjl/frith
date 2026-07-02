import { useEffect, useState } from 'react';
import type { ProfilePageDto, UserDto } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ProfileView({
  userId,
  me,
  online,
  onOpenDm,
  onOpenChannel,
  onEditProfile,
}: {
  userId: string;
  me: UserDto;
  online: Set<string>;
  onOpenDm: (userId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onEditProfile: () => void;
}) {
  const [profile, setProfile] = useState<ProfilePageDto | null>(null);

  useEffect(() => {
    setProfile(null);
    api.profile(userId).then(setProfile).catch(console.error);
  }, [userId]);

  if (!profile) return <main className="main profile" />;
  const { user, stats, topChannels, recent } = profile;
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
          ) : (
            <button className="btn primary" onClick={() => onOpenDm(user.id)}>
              Message
            </button>
          )}
        </header>

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
