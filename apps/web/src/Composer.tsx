import { useState } from 'react';
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

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await api.send(channelId, body, parentMessageId);
  }

  return (
    <div className="composer">
      <input
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
    </div>
  );
}
