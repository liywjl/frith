// One feed entry — used by the space feed and by profile timelines.
import type { FeedItemDto } from '@app/shared';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Mentions } from './Mentions';
import { PhotoThumb } from './PhotoThumb';
import { useUserActions } from '../lib/userActions';
import { linkIcon } from '../lib/socials';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function dayLabel(at: string): string {
  const day = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return 'Today';
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return dayFormat.format(day);
}

/** A day-grouped list of feed cards — the space feed and profile timelines. */
export function FeedTimeline({
  items,
  onOpenChannel,
  onOpenDoc,
  onOpenThread,
}: {
  items: FeedItemDto[];
  onOpenChannel: (channelId: string) => void;
  onOpenDoc: (docId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
}) {
  let lastDay = '';
  return (
    <>
      {items.map((item) => {
        const day = dayLabel(item.at);
        const header = day !== lastDay ? <div className="home-h feed-day">{day}</div> : null;
        lastDay = day;
        return (
          <div key={item.id}>
            {header}
            <FeedCard item={item} onOpenChannel={onOpenChannel} onOpenDoc={onOpenDoc} onOpenThread={onOpenThread} />
          </div>
        );
      })}
    </>
  );
}

function FeedCard({
  item,
  onOpenChannel,
  onOpenDoc,
  onOpenThread,
}: {
  item: FeedItemDto;
  onOpenChannel: (channelId: string) => void;
  onOpenDoc: (docId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
}) {
  const { openProfile } = useUserActions();

  const who = (
    <button className="feed-who" onClick={() => openProfile(item.author.id)}>
      <Avatar name={item.author.name} emoji={item.author.avatarEmoji} />
      <b>{item.author.name}</b>
    </button>
  );
  const when = <span className="home-when">{timeFormat.format(new Date(item.at))}</span>;

  if (item.kind === 'enjoying') {
    return (
      <div className="feed-card feed-enjoying">
        <div className="feed-card-top">
          {who}
          <span className="feed-verb">is currently enjoying</span>
          {when}
        </div>
        <div className="feed-enjoying-what">
          <Icon name="headphones" /> {item.nowPlaying}
        </div>
      </div>
    );
  }

  if (item.kind === 'doc') {
    return (
      <div className="feed-card">
        <div className="feed-card-top">
          {who}
          <span className="feed-verb">updated a page</span>
          {when}
        </div>
        <button className="feed-doc" onClick={() => onOpenDoc(item.docId)}>
          <Icon name="doc" /> {item.title}
        </button>
      </div>
    );
  }

  const channel = (
    <button className="feed-channel" onClick={() => onOpenChannel(item.channelId)}>
      # {item.channelName}
    </button>
  );
  // Comments are the post's thread — same data, social framing.
  const meta = (item.comments > 0 || item.reactions > 0) && (
    <div className="feed-meta">
      <button className="feed-comments" onClick={() => onOpenThread(item.messageId, item.channelId)}>
        💬 {item.comments === 0 ? 'comment' : item.comments === 1 ? '1 comment' : `${item.comments} comments`}
      </button>
      {item.reactions > 0 && <span className="feed-hearts">♡ {item.reactions}</span>}
    </div>
  );

  if (item.kind === 'message') {
    return (
      <div className="feed-card">
        <div className="feed-card-top">
          {who}
          <span className="feed-verb">posted in</span>
          {channel}
          {when}
        </div>
        {item.body && (
          <p className="feed-body">
            <Mentions text={item.body} />
          </p>
        )}
        {meta}
      </div>
    );
  }

  if (item.kind === 'photos') {
    const clips = item.photos.filter((p) => p.mime === 'image/gif').length;
    const noun = clips > 0 ? (item.photos.length > 1 ? 'clips' : 'a clip') : item.photos.length > 1 ? `${item.photos.length} photos` : 'a photo';
    return (
      <div className="feed-card">
        <div className="feed-card-top">
          {who}
          <span className="feed-verb">shared {noun} in</span>
          {channel}
          {when}
        </div>
        {item.body && (
          <p className="feed-body">
            <Mentions text={item.body} />
          </p>
        )}
        <div className="feed-photos">
          {item.photos.map((p) => (
            <PhotoThumb key={p.id} photo={p} />
          ))}
        </div>
        {meta}
      </div>
    );
  }

  return (
    <div className="feed-card">
      <div className="feed-card-top">
        {who}
        <span className="feed-verb">shared a link in</span>
        {channel}
        {when}
      </div>
      {item.body && (
        <p className="feed-body">
          <Mentions text={item.body} />
        </p>
      )}
      <div className="feed-links">
        {item.links.map((l) => (
          <a key={l.url} className="feed-link" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
            <Icon name={linkIcon(l.url)} /> {l.domain}
          </a>
        ))}
      </div>
      {meta}
    </div>
  );
}
