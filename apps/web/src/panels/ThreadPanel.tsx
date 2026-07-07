import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChannelDto, MeDto, MessageDto, ServerEvent } from '@app/shared';
import { api } from '../lib/api';
import { useRealtime } from '../lib/useRealtime';
import { applyReaction } from '../lib/updates';
import { Composer } from '../components/Composer';
import { Message } from '../components/Message';
import { useWindowedFeed } from '../lib/useWindowedFeed';

export function ThreadPanel({
  me,
  channel,
  root,
  onClose,
}: {
  me: MeDto;
  channel: ChannelDto;
  root: MessageDto;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const { visible, hiddenCount, onScroll } = useWindowedFeed(feedRef, messages, root.id);

  useEffect(() => {
    api.thread(root.id).then(setMessages).catch(console.error);
  }, [root.id]);

  const onEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === 'reaction.changed') {
        setMessages((cur) => applyReaction(cur, event, me.id));
        return;
      }
      if (event.type !== 'message.created') return;
      const msg = event.message;
      if (msg.parentMessageId !== root.id) return;
      if (me.blockedUserIds.includes(msg.authorId)) return;
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
    },
    [root.id, me.id],
  );
  useRealtime(onEvent);

  return (
    <aside className="thread-panel">
      <header className="topbar">
        <span className="chan">Thread</span>
        <button className="close" onClick={onClose} aria-label="Close thread">
          ✕
        </button>
      </header>
      <div className="feed" ref={feedRef} onScroll={onScroll}>
        {hiddenCount > 0 && <div className="feed-more">↑ {hiddenCount} earlier replies</div>}
        {visible.map((m) => (
          <Message key={m.id} message={m} own={m.authorId === me.id} />
        ))}
      </div>
      <Composer channelId={channel.id} parentMessageId={root.id} placeholder="Reply…" />
    </aside>
  );
}
