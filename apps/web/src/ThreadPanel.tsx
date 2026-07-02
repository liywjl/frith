import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto, MessageDto, ServerEvent } from '@app/shared';
import { api } from './api';
import { useRealtime } from './useRealtime';
import { Composer } from './Composer';
import { Message } from './Message';

export function ThreadPanel({
  channel,
  root,
  onClose,
}: {
  channel: ChannelDto;
  root: MessageDto;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<MessageDto[]>([]);

  useEffect(() => {
    api.thread(root.id).then(setMessages).catch(console.error);
  }, [root.id]);

  const onEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type !== 'message.created') return;
      const msg = event.message;
      if (msg.parentMessageId !== root.id) return;
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
    },
    [root.id],
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
      <div className="feed">
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </div>
      <Composer channelId={channel.id} parentMessageId={root.id} placeholder="Reply…" />
    </aside>
  );
}
