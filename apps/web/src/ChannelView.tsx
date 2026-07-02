import { Fragment, useEffect, useRef } from 'react';
import type { ChannelDto, MessageDto } from '@app/shared';
import { api } from './api';
import { Composer } from './Composer';
import { Message } from './Message';

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** Group consecutive messages: same author within 5 minutes lose their header. */
function isCompact(prev: MessageDto | undefined, m: MessageDto): boolean {
  if (!prev) return false;
  if (prev.authorId !== m.authorId) return false;
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
}

function isNewDay(prev: MessageDto | undefined, m: MessageDto): boolean {
  if (!prev) return true;
  return new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
}

export function ChannelView({
  channel,
  messages,
  onOpenThread,
  onOpenAsk,
}: {
  channel: ChannelDto;
  messages: MessageDto[];
  onOpenThread: (root: MessageDto) => void;
  onOpenAsk: () => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, channel.id]);

  const label = channel.type === 'dm' ? channel.dmPartnerNames?.join(', ') : `# ${channel.name}`;

  return (
    <main className="main">
      <header className="topbar">
        <span className="chan">{label}</span>
        {channel.archivedAt && <span className="archived-chip">archived</span>}
        {channel.topic && <span className="topic">{channel.topic}</span>}
        <button className="askbtn" onClick={onOpenAsk}>
          <span className="askbtn-hint">Ask Lore — people, threads, decisions…</span>
          <kbd>⌘J</kbd>
        </button>
        {channel.type !== 'dm' && !channel.archivedAt && (
          <button
            className="archive-btn"
            title="Archive this channel — it becomes read-only but stays searchable"
            onClick={() => void api.setArchived(channel.id, true)}
          >
            🗄
          </button>
        )}
      </header>
      <div className="feed" ref={feedRef}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = isNewDay(prev, m);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="day-sep">
                  <span>{dayFormat.format(new Date(m.createdAt))}</span>
                </div>
              )}
              <Message
                message={m}
                compact={!newDay && isCompact(prev, m)}
                onOpenThread={onOpenThread}
              />
            </Fragment>
          );
        })}
        {messages.length === 0 && (
          <div className="feed-empty">Nothing here yet — say something.</div>
        )}
      </div>
      {channel.archivedAt ? (
        <div className="archived-banner">
          <span>This channel is archived — read-only, but its history still feeds Ask.</span>
          <button className="btn" onClick={() => void api.setArchived(channel.id, false)}>
            Unarchive
          </button>
        </div>
      ) : (
        <Composer channelId={channel.id} placeholder={`Message ${label}`} />
      )}
    </main>
  );
}
