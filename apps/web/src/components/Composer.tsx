import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { EMOJI } from '../lib/emoji';

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

  // :emo → emoji suggestions; a completed :emoji: converts as you type.
  const emojiTyping = /:([a-z0-9_]{2,})$/.exec(draft);
  const emojiMatches = emojiTyping
    ? Object.entries(EMOJI).filter(([name]) => name.startsWith(emojiTyping[1]!)).slice(0, 8)
    : [];

  function pickEmoji(name: string, emoji: string) {
    setDraft((d) => d.replace(/:([a-z0-9_]{2,})$/, emoji));
    void name;
    ref.current?.focus();
  }

  function onDraftChange(value: string) {
    setDraft(value.replace(/:([a-z0-9_]+):$/, (m, name: string) => EMOJI[name] ?? m));
  }

  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function attach(file: File) {
    const caption = draft.trim();
    setDraft('');
    await api.attach(channelId, file, caption, parentMessageId);
  }

  async function toggleVoice() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void attach(new File(chunks, 'voice-note.webm', { type: 'audio/webm' }));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      // no mic permission — nothing to record
    }
  }

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
      {emojiMatches.length > 0 && (
        <div className="slash-menu emoji-menu">
          {emojiMatches.map(([name, emoji], i) => (
            <button
              key={name}
              className={i === 0 ? 'selected' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pickEmoji(name, emoji);
              }}
            >
              <b>{emoji}</b>
              <span>:{name}:</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (emojiMatches[0]) pickEmoji(emojiMatches[0][0], emojiMatches[0][1]);
              else void send();
            } else if (e.key === 'Escape' && (slashing || emojiMatches.length > 0)) {
              e.stopPropagation();
              setDraft('');
            }
          }}
        />
        <button
          className="composer-tool"
          title="Attach an image, video, or file (your draft becomes the caption)"
          onClick={() => fileInput.current?.click()}
        >
          📎
        </button>
        <button
          className={`composer-tool ${recording ? 'recording' : ''}`}
          title={recording ? 'Stop and send voice note' : 'Record a voice note'}
          onClick={() => void toggleVoice()}
        >
          {recording ? '⏺' : '🎤'}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="image/*,video/*,audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void attach(file);
          }}
        />
      </div>
      <span className="composer-hint">
        {recording
          ? 'Recording… click ⏺ to send'
          : `Enter to send · Shift+Enter for a new line · :emoji:${commands.length > 0 ? ' · / for quick actions' : ''}`}
      </span>
    </div>
  );
}
