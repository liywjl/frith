import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export function Composer({
  channelId,
  parentMessageId,
  placeholder,
}: {
  channelId: string;
  parentMessageId?: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await api.send(channelId, body, parentMessageId);
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
    </div>
  );
}
