import { useEffect, useState } from 'react';
import type { ConnectDto, HomeDto, UserDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { ThreadCard } from '../components/ThreadCard';
import { useUserActions } from '../lib/userActions';

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function channelLabel(u: { type: string; name: string; dmPartnerNames?: string[] }): string {
  return u.type === 'dm' ? (u.dmPartnerNames ?? []).join(', ') : `# ${u.name}`;
}

export function HomeView({
  me,
  refreshTick,
  onOpenChannel,
  onOpenThread,
  onOpenAsk,
  onStartGroup,
}: {
  me: UserDto;
  /** Bumped by the app when new activity arrives, to refetch the digest. */
  refreshTick: number;
  onOpenChannel: (channelId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
  onOpenAsk: () => void;
  onStartGroup: (userIds: string[]) => void;
}) {
  const { openDm } = useUserActions();
  const [home, setHome] = useState<HomeDto | null>(null);
  const [connect, setConnect] = useState<ConnectDto | null>(null);

  useEffect(() => {
    api.home().then(setHome).catch(console.error);
  }, [refreshTick]);

  useEffect(() => {
    api.connect().then(setConnect).catch(console.error);
  }, []);

  if (!home) return <main className="main home" />;
  const caughtUp = home.unread.length === 0 && home.threads.length === 0;

  return (
    <main className="main home">
      <div className="home-scroll">
        <header className="home-head">
          <h1>
            {greeting()}, {me.name.split(' ')[0]}
          </h1>
          <p>Here's what needs you — in one place.</p>
          <button className="askbtn home-ask" onClick={onOpenAsk}>
            <span className="askbtn-hint">Ask Frith — people, threads, decisions…</span>
            <kbd>⌘J</kbd>
          </button>
        </header>

        {caughtUp && <div className="home-empty">You're all caught up ✨</div>}

        <div className="home-columns">
        {home.unread.length > 0 && (
          <section>
            <div className="home-h">While you were away</div>
            <div className="home-grid">
            {home.unread.map((u) => (
              <button key={u.channelId} className="home-card" onClick={() => onOpenChannel(u.channelId)}>
                <span className="home-card-top">
                  <b>{channelLabel(u)}</b>
                  <span className="unread-badge">{u.unreadCount}</span>
                </span>
                <span className="home-snippet">
                  {u.latestAuthor}: {u.latestSnippet}
                </span>
                <span className="home-when">{timeFormat.format(new Date(u.latestAt))}</span>
              </button>
            ))}
            </div>
          </section>
        )}

        {home.popular.length > 0 && (
          <section>
            <div className="home-h">Popular threads</div>
            <div className="home-grid">
            {home.popular.map((p) => (
              <button key={p.rootId} className="home-card" onClick={() => onOpenThread(p.rootId, p.channelId)}>
                <span className="home-card-top">
                  <b># {p.channelName}</b>
                  <span className="home-engagement">
                    {p.reactionCount > 0 && <span>♡ {p.reactionCount}</span>}
                    {p.replyCount > 0 && <span>↳ {p.replyCount}</span>}
                  </span>
                </span>
                <span className="home-snippet">
                  {p.authorName}: {p.snippet}
                </span>
              </button>
            ))}
            </div>
          </section>
        )}

        {home.threads.length > 0 && (
          <section>
            <div className="home-h">Threads you're in</div>
            <div className="home-grid">
            {home.threads.map((t) => (
              <ThreadCard
                key={t.rootId}
                channelName={t.channelName}
                corner={<span className="home-replies">↳ {t.replyCount} replies</span>}
                onClick={() => onOpenThread(t.rootId, t.channelId)}
              >
                <span className="home-snippet">
                  {t.rootAuthorName}: {t.rootSnippet}
                </span>
                <span className="home-when">
                  latest from {t.lastReplyAuthor} · {timeFormat.format(new Date(t.lastReplyAt))}
                </span>
              </ThreadCard>
            ))}
            </div>
          </section>
        )}

        {connect && (connect.people.length > 0 || connect.groups.length > 0) && (
          <section>
            <div className="home-h">Find your people</div>
            {connect.groups.map((g) => (
              <div key={g.interest} className="home-card connect-card">
                <span className="home-card-top">
                  <b>{g.members.length + 1} of you are into {g.interest}</b>
                  <button
                    className="btn primary"
                    onClick={() =>
                      g.existingChannelId
                        ? onOpenChannel(g.existingChannelId)
                        : onStartGroup(g.members.map((m) => m.id))
                    }
                  >
                    {g.existingChannelId ? `Open # ${g.interest}` : 'Start a group chat'}
                  </button>
                </span>
                <span className="connect-members">
                  {g.members.map((m) => (
                    <button key={m.id} className="connect-member" onClick={() => openDm(m.id)}>
                      <Avatar name={m.name} emoji={m.avatarEmoji} />
                      {m.name.split(' ')[0]}
                    </button>
                  ))}
                </span>
              </div>
            ))}
            {connect.people.length > 0 && (
              <div className="connect-people">
                {connect.people.map((p) => (
                  <button key={p.user.id} className="connect-person" onClick={() => openDm(p.user.id)}>
                    <Avatar name={p.user.name} emoji={p.user.avatarEmoji} />
                    <span>
                      <b>{p.user.name}</b>
                      <small>also into {p.sharedInterests.join(', ')}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="profile-privacy">Suggestions come from the interests people chose to share on their profiles.</p>
          </section>
        )}
        </div>
      </div>
    </main>
  );
}
