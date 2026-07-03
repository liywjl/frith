import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface SlashCommand {
  name: string;
  hint: string;
  run: (arg: string) => void;
}

export function Composer({
  channelId,
  parentMessageId,
  placeholder,
  commands = [],
}: {
  channelId: string;
  parentMessageId?: string;
  placeholder: string;
  commands?: SlashCommand[];
}) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Click a channel or person → just start typing.
  useEffect(() => {
    ref.current?.focus();
  }, [channelId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const slashing = draft.startsWith('/') && !draft.includes('\n');
  const typed = slashing ? draft.slice(1) : '';
  const [typedCmd = '', ...typedArg] = typed.split(' ');
  const matches = slashing ? commands.filter((c) => c.name.startsWith(typedCmd.toLowerCase())) : [];

  async function send() {
    const body = draft.trim();
    if (!body) return;

    if (slashing && matches[0]) {
      setDraft('');
      matches[0].run(typedArg.join(' ').trim());
      return;
    }

    setDraft('');
    await api.send(channelId, body, parentMessageId);
  }

  return (
    <div className="composer">
      {matches.length > 0 && (
        <div className="slash-menu">
          {matches.map((c, i) => (
            <button
              key={c.name}
              className={i === 0 ? 'selected' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                setDraft(`/${c.name} `);
                ref.current?.focus();
              }}
            >
              <b>/{c.name}</b>
              <span>{c.hint}</span>
            </button>
          ))}
        </div>
      )}
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
          } else if (e.key === 'Escape' && slashing) {
            e.stopPropagation();
            setDraft('');
          }
        }}
      />
      <span className="composer-hint">
        Enter to send · Shift+Enter for a new line{commands.length > 0 && ' · / for quick actions'}
      </span>
    </div>
  );
}
