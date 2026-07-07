import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api } from '../lib/api';
import { EMOJI } from '../lib/emoji';
import { Icon, type IconName } from './Icon';

export interface SlashCommand {
  name: string;
  hint: string;
  run: (arg: string) => void;
}

/** Lets the surrounding view (e.g. a channel-wide drop zone) stage files. */
export interface ComposerHandle {
  addFiles: (files: Iterable<File>) => void;
}

const MB = 1024 * 1024;
// Mirrors the server's default `maxUploadMB` — bigger uploads are rejected
// outright, so we stop them here before wasting the transfer.
const MAX_MB = 100;
// Above this, a file is slow to share across the P2P network; we still allow
// it, but warn so nobody accidentally floods peers with a huge blob.
const WARN_MB = 25;

function formatSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function iconFor(file: File): IconName {
  if (file.type.startsWith('video/')) return 'film';
  if (file.type.startsWith('audio/')) return 'music';
  if (file.type.startsWith('image/')) return 'image';
  return 'doc';
}

function AttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  const big = file.size > WARN_MB * MB;
  return (
    <div className={`att-chip ${big ? 'warn' : ''}`}>
      <div className="att-tile" title={`${file.name} · ${formatSize(file.size)}`}>
        {isImage && url ? <img src={url} alt={file.name} /> : <Icon name={iconFor(file)} size={22} />}
      </div>
      <button className="att-remove" title="Remove attachment" onClick={onRemove}>
        ✕
      </button>
      <span className="att-name" title={file.name}>
        {file.name}
      </span>
    </div>
  );
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    channelId: string;
    parentMessageId?: string;
    placeholder: string;
    commands?: SlashCommand[];
  }
>(function Composer({ channelId, parentMessageId, placeholder, commands = [] }, handleRef) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Click a channel, person, or thread → just start typing.
  useEffect(() => {
    ref.current?.focus();
  }, [channelId, parentMessageId]);

  // Switching channels drops whatever was staged for the old one.
  useEffect(() => {
    setPending([]);
    setNotice(null);
  }, [channelId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function addFiles(files: Iterable<File>) {
    const accepted: File[] = [];
    let rejected: string | null = null;
    for (const file of files) {
      if (file.size > MAX_MB * MB) rejected = `“${file.name}” is ${formatSize(file.size)} — files are capped at ${MAX_MB} MB.`;
      else accepted.push(file);
    }
    if (accepted.length) setPending((p) => [...p, ...accepted]);
    if (rejected) setNotice(rejected);
    else if (accepted.some((f) => f.size > WARN_MB * MB)) setNotice(`Large file — this may be slow to share with everyone.`);
    else setNotice(null);
    ref.current?.focus();
  }

  useImperativeHandle(handleRef, () => ({ addFiles }));

  const slashing = draft.startsWith('/') && !draft.includes('\n');
  const typed = slashing ? draft.slice(1) : '';
  const [typedCmd = '', ...typedArg] = typed.split(' ');
  const matches = slashing && pending.length === 0 ? commands.filter((c) => c.name.startsWith(typedCmd.toLowerCase())) : [];

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
        addFiles([new File(chunks, 'voice-note.webm', { type: 'audio/webm' })]);
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

    // Files staged → send each as an attachment; the draft rides the first one
    // as its caption. (One attachment per message is the backend's shape.)
    if (pending.length > 0) {
      const files = pending;
      setPending([]);
      setDraft('');
      setNotice(null);
      let i = 0;
      try {
        for (; i < files.length; i++) {
          await api.attach(channelId, files[i]!, i === 0 ? body : '', parentMessageId);
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Upload failed.');
        setPending(files.slice(i)); // keep the ones that didn't make it
      }
      return;
    }

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
      {pending.length > 0 && (
        <div className="composer-attachments">
          {pending.map((file, i) => (
            <AttachmentPreview
              key={`${file.name}-${file.size}-${i}`}
              file={file}
              onRemove={() => {
                setPending((p) => p.filter((_, j) => j !== i));
                setNotice(null);
              }}
            />
          ))}
        </div>
      )}
      {notice && (
        <div className="composer-notice">
          <Icon name="warning" /> {notice}
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
          title="Attach an image, video, or file"
          onClick={() => fileInput.current?.click()}
        >
          📎
        </button>
        <button
          className={`composer-tool ${recording ? 'recording' : ''}`}
          title={recording ? 'Stop recording' : 'Record a voice note'}
          onClick={() => void toggleVoice()}
        >
          {recording ? '⏺' : '🎤'}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <span className="composer-hint">
        {recording
          ? 'Recording… click ⏺ to stop'
          : pending.length > 0
            ? 'Enter to send · drop or 📎 to add more'
            : `Enter to send · Shift+Enter for a new line · :emoji:${commands.length > 0 ? ' · / for quick actions' : ''}`}
      </span>
    </div>
  );
});
