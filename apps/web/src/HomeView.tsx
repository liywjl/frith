import { useEffect, useState } from 'react';
import type { HomeDto, UserDto } from '@app/shared';
import { api } from './api';
import { ThreadCard } from './ThreadCard';

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
}: {
  me: UserDto;
  /** Bumped by the app when new activity arrives, to refetch the digest. */
  refreshTick: number;
  onOpenChannel: (channelId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
  onOpenAsk: () => void;
}) {
  const [home, setHome] = useState<HomeDto | null>(null);

  useEffect(() => {
    api.home().then(setHome).catch(console.error);
  }, [refreshTick]);

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
            <span className="askbtn-hint">Ask Lore — people, threads, decisions…</span>
            <kbd>⌘J</kbd>
          </button>
        </header>

        {caughtUp && <div className="home-empty">You're all caught up ✨</div>}

        {home.unread.length > 0 && (
          <section>
            <div className="home-h">While you were away</div>
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
          </section>
        )}

        {home.popular.length > 0 && (
          <section>
            <div className="home-h">Popular threads</div>
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
          </section>
        )}

        {home.threads.length > 0 && (
          <section>
            <div className="home-h">Threads you're in</div>
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
          </section>
        )}
      </div>
    </main>
  );
}
