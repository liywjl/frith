import { useEffect, useRef } from 'react';
import type { ChannelDto, MessageDto } from '@app/shared';
import { Composer } from './Composer';
import { Message } from './Message';

export function ChannelView({
  channel,
  messages,
  onOpenThread,
}: {
  channel: ChannelDto;
  messages: MessageDto[];
  onOpenThread: (root: MessageDto) => void;
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
        {channel.topic && <span className="topic">{channel.topic}</span>}
        <button className="askbtn" title="The Ask surface arrives with the knowledge plane" disabled>
          Ask <kbd>⌘K</kbd>
        </button>
      </header>
      <div className="feed" ref={feedRef}>
        {messages.map((m) => (
          <Message key={m.id} message={m} onOpenThread={onOpenThread} />
        ))}
      </div>
      <Composer channelId={channel.id} placeholder={`Message ${label}`} />
    </main>
  );
}
