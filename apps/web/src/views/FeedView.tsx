// The feed: what your people shared, strictly newest-first. Chronology is
// the whole algorithm — no ranking, no engagement loops — and it has an end.
import { useEffect, useState } from 'react';
import type { FeedDto } from '@app/shared';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { FeedTimeline } from '../components/FeedCard';

export function FeedView({
  refreshTick,
  onOpenChannel,
  onOpenDoc,
  onOpenThread,
}: {
  /** Bumped by the app when new activity arrives, to refetch. */
  refreshTick: number;
  onOpenChannel: (channelId: string) => void;
  onOpenDoc: (docId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
}) {
  const [feed, setFeed] = useState<FeedDto | null>(null);

  useEffect(() => {
    api.feed().then(setFeed).catch(console.error);
  }, [refreshTick]);

  if (!feed) return <main className="main feed" />;

  return (
    <main className="main feed">
      <div className="home-scroll feed-scroll">
        <header className="home-head">
          <h1>Feed</h1>
          <p>What your people shared — newest first, no algorithm, no ranking. Just time.</p>
        </header>

        <FeedTimeline items={feed.items} onOpenChannel={onOpenChannel} onOpenDoc={onOpenDoc} onOpenThread={onOpenThread} />

        {feed.items.length === 0 ? (
          <div className="home-empty">
            Nothing shared yet — drop a link or a photo into any channel and it lands here.
          </div>
        ) : (
          <div className="feed-end">
            <Icon name="flame" size={18} />
            <b>You're all caught up.</b>
            <span>The feed is chronological and it ends. Go skate, or whatever it is you do.</span>
          </div>
        )}
      </div>
    </main>
  );
}
