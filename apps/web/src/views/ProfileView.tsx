// A person's page — social first: hero with bio and links, an intro column,
// and a tabbed main column whose default is their timeline (what they've
// shared), not their message count. The work-ish views live one tab over.
import { useEffect, useState, type CSSProperties } from 'react';
import type { FeedDto, MeDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { PhotoThumb } from '../components/PhotoThumb';
import { FeedTimeline } from '../components/FeedCard';
import { Mentions } from '../components/Mentions';
import { useProfile } from '../lib/useProfile';
import { useUserActions } from '../lib/userActions';
import { bannerStyle } from '../lib/banner';
import { linkIcon, linkDomain } from '../lib/socials';
import { ArtifactChips } from '../components/ArtifactChips';

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type Tab = 'timeline' | 'chats' | 'groups';

export function ProfileView({
  userId,
  me,
  online,
  onOpenDm,
  onOpenChannel,
  onOpenDoc,
  onOpenThread,
  onEditProfile,
  onToggleBlock,
  onMeChange,
}: {
  userId: string;
  me: MeDto;
  online: Set<string>;
  onOpenDm: (userId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onOpenDoc: (docId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
  onEditProfile: () => void;
  onToggleBlock: (userId: string, blocked: boolean) => void;
  onMeChange: (me: MeDto) => void;
}) {
  const { openProfile, openTag } = useUserActions();
  const profile = useProfile(userId);
  const [tab, setTab] = useState<Tab>('timeline');
  const [timeline, setTimeline] = useState<FeedDto | null>(null);

  useEffect(() => {
    setTab('timeline');
    setTimeline(null);
    api.userFeed(userId).then(setTimeline).catch(console.error);
  }, [userId]);

  if (!profile) return <main className="main profile" />;
  const { user, stats, topChannels, teammates, popular, artifacts, recent, photos } = profile;
  const isMe = user.id === me.id;
  // Their chosen accent re-scopes the accent variable for this page only —
  // visiting a profile means stepping into their colour, like a good blog.
  const accent = user.accentColor ? ({ '--ai': user.accentColor } as CSSProperties) : undefined;

  return (
    <main className="main profile" style={accent}>
      <div className="home-scroll profile-scroll">
        <div className="profile-banner" style={bannerStyle(user.handle)} />
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
              {user.location && (
                <>
                  {' · '}
                  <span className="profile-location">
                    <Icon name="pin" /> {user.location}
                  </span>
                </>
              )}
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

        {user.bio && (
          <p className="profile-bio">
            <Mentions text={user.bio} />
          </p>
        )}
        {user.links.length > 0 && (
          <div className="profile-links">
            {user.links.map((l) => (
              <a key={l.url} className="profile-link" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
                <Icon name={linkIcon(l.url)} /> {l.label} <small>{linkDomain(l.url)}</small>
              </a>
            ))}
          </div>
        )}

        <div className="profile-cols">
          <aside className="profile-side">
            {(isMe || user.nowPlaying || user.interests.length > 0) && (
              <section className="home-card profile-intro">
                <div className="home-h">Into</div>
                {user.nowPlaying && (
                  <div className="now-playing">
                    <Icon name="headphones" /> {user.nowPlaying}
                  </div>
                )}
                <div className="profile-chips">
                  {(isMe ? me.interests : user.interests).map((i) => (
                    <button key={i} className="interest-chip" title={`See who else is into ${i}`} onClick={() => openTag(i)}>
                      {i}
                      {!isMe && me.interests.some((m) => m.toLowerCase() === i.toLowerCase()) && <small> · you too</small>}
                      {isMe && (
                        <small
                          className="chip-remove"
                          title={`Remove ${i}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const interests = me.interests.filter((m) => m !== i);
                            void api.patchMe({ interests }).then(() => onMeChange({ ...me, interests }));
                          }}
                        >
                          {' '}✕
                        </small>
                      )}
                    </button>
                  ))}
                  {isMe && (
                    <form
                      className="tag-add-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements.namedItem('tag') as HTMLInputElement;
                        const value = input.value.trim();
                        if (!value) return;
                        const interests = [...me.interests.filter((m) => m.toLowerCase() !== value.toLowerCase()), value].slice(0, 12);
                        input.value = '';
                        void api.patchMe({ interests }).then(() => onMeChange({ ...me, interests }));
                      }}
                    >
                      <input className="tag-add" name="tag" placeholder="add a tag" aria-label="Add a tag" />
                      <button type="submit" className="tag-add-btn" title="Add tag" aria-label="Add tag">+</button>
                    </form>
                  )}
                </div>
              </section>
            )}

            {photos.length > 0 && (
              <section className="home-card profile-intro">
                <div className="home-h">Photos</div>
                <div className="photo-wall">
                  {photos.slice(0, 6).map((p) => (
                    <PhotoThumb key={p.id} photo={p} />
                  ))}
                </div>
              </section>
            )}

            <section className="home-card profile-intro profile-mini-stats">
              <div className="home-h">In this space</div>
              <div>
                <b>{stats.messages}</b> messages · <b>{stats.channelsActive}</b> channels ·{' '}
                <b>{stats.reactionsReceived}</b> reactions
              </div>
              <p className="profile-privacy">
                Everything here is scoped to channels you can read — never direct messages.
              </p>
            </section>
          </aside>

          <div className="profile-main">
            <div className="profile-tabs">
              {(
                [
                  ['timeline', 'Feed'],
                  ['chats', 'Chats'],
                  ['groups', 'Groups & people'],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button key={key} className={`profile-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'timeline' && (
              <section>
                {timeline === null && <div className="home-empty">Loading…</div>}
                {timeline?.items.length === 0 && (
                  <div className="home-empty">
                    {isMe ? 'Nothing shared yet — drop a link or a photo into any channel.' : `${user.name.split(' ')[0]} hasn't shared anything you can see yet.`}
                  </div>
                )}
                {timeline && (
                  <FeedTimeline
                    items={timeline.items}
                    onOpenChannel={onOpenChannel}
                    onOpenDoc={onOpenDoc}
                    onOpenThread={onOpenThread}
                  />
                )}
              </section>
            )}

            {tab === 'chats' && (
              <section>
                {popular.length > 0 && (
                  <>
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
                  </>
                )}
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
                <ArtifactChips title="Code & docs they touch" artifacts={artifacts} onOpenChannel={onOpenChannel} />
              </section>
            )}

            {tab === 'groups' && (
              <section>
                {teammates.length > 1 && (
                  <>
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
                  </>
                )}
                {topChannels.length > 0 && (
                  <>
                    <div className="home-h">Hangs out in</div>
                    <div className="profile-chips">
                      {topChannels.map((c) => (
                        <button key={c.id} className="profile-chip" onClick={() => onOpenChannel(c.id)}>
                          # {c.name} <small>{c.count}</small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {user.interests.length > 0 && (
                  <p className="profile-privacy">
                    Click any interest in the intro card to see who else is into it — and start a group from there.
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
