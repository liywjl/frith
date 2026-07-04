import { useState } from 'react';
import type { AttachmentDto, MessageDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { UserHover } from './UserHover';
import { useUserActions } from '../lib/userActions';

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * One attachment. Cached media renders inline; uncached bytes show a fetch
 * chip (they live on a peer until you ask); dangerous files never render and
 * say why.
 */
function Attachment({ a }: { a: AttachmentDto }) {
  const [state, setState] = useState<'idle' | 'fetching' | 'failed'>('idle');

  if (a.dangerous) {
    return (
      <a className="att-file att-danger" href={a.url} download title="This file type can run code. Only open it if you trust the sender.">
        ⚠️ {a.name} · {fmtSize(a.size)}
      </a>
    );
  }
  if (!a.cached) {
    // Bytes are on a peer, not on this device — fetching is a choice
    // (auto-fetch already declined it: too big, too old, or author blocked).
    const fetchNow = () => {
      setState('fetching');
      api.fetchFile(a.id).catch(() => setState('failed'));
      // success flips `cached` via the file.cached realtime event
    };
    return (
      <button className="att-file att-fetch" onClick={fetchNow} disabled={state === 'fetching'}>
        {state === 'fetching' ? '⏳ fetching from peers…' : state === 'failed' ? '📡 no peer online has this — retry?' : `⬇️ ${a.name} · ${fmtSize(a.size)}`}
      </button>
    );
  }
  if (a.kind === 'image') {
    return (
      <a href={a.url} target="_blank" rel="noreferrer">
        <img className="att-img" src={a.url} alt={a.name} />
      </a>
    );
  }
  if (a.kind === 'video') return <video className="att-video" src={a.url} controls />;
  if (a.kind === 'audio') return <audio className="att-audio" src={a.url} controls />;
  return (
    <a className="att-file" href={a.url} target="_blank" rel="noreferrer">
      📎 {a.name} · {fmtSize(a.size)}
    </a>
  );
}

const QUICK_EMOJIS = ['👍', '❤️', '✅', '😂', '🎉'];
const ALL_EMOJIS = [
  '👍', '❤️', '✅', '😂', '🎉', '👀', '🔥', '🚀',
  '💯', '🙌', '👏', '🤔', '😍', '😅', '😭', '🫡',
  '🙏', '💡', '☕', '🍕', '🐶', '🌈', '⚡', '🧠',
  '🎯', '🛰️', '🤝', '🥳', '😴', '🤯', '📌', '🍿',
];

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function Message({
  message,
  compact,
  onOpenThread,
}: {
  message: MessageDto;
  /** Consecutive message from the same author — hide the avatar/header. */
  compact?: boolean;
  onOpenThread?: (root: MessageDto) => void;
}) {
  const { openProfile } = useUserActions();
  const [pickerOpen, setPickerOpen] = useState(false);

  function react(emoji: string) {
    setPickerOpen(false);
    void api.react(message.id, emoji);
  }
  return (
    <div className={`msg ${compact ? 'compact' : ''}`}>
      {compact ? (
        <div className="msg-gutter">{timeFormat.format(new Date(message.createdAt))}</div>
      ) : (
        <UserHover userId={message.authorId} name={message.authorName}>
          <Avatar name={message.authorName} emoji={message.authorAvatarEmoji} />
        </UserHover>
      )}
      <div className="msg-main">
        {!compact && (
          <div>
            <UserHover userId={message.authorId} name={message.authorName}>
              <button className="who who-link" onClick={() => openProfile(message.authorId)}>
                {message.authorName}
              </button>
            </UserHover>
            <span className="when">{timeFormat.format(new Date(message.createdAt))}</span>
          </div>
        )}
        {message.body && <div className="body">{message.body}</div>}
        {message.attachments.map((a) => (
          <Attachment key={a.id} a={a} />
        ))}
        <div className="msg-meta">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              className={`react-chip ${r.mine ? 'mine' : ''}`}
              onClick={() => void api.react(message.id, r.emoji)}
            >
              {r.emoji} {r.count}
            </button>
          ))}
          {onOpenThread && (
            <button className="thread-pill" onClick={() => onOpenThread(message)}>
              {message.replyCount > 0 ? `↳ ${message.replyCount} replies` : 'Reply in thread'}
            </button>
          )}
        </div>
      </div>
      <div className="msg-actions">
        {QUICK_EMOJIS.map((e) => (
          <button key={e} title={`React ${e}`} onClick={() => react(e)}>
            {e}
          </button>
        ))}
        <button className="more-emoji" title="More reactions" onClick={() => setPickerOpen((v) => !v)}>
          +
        </button>
        {pickerOpen && (
          <div className="emoji-grid" onMouseLeave={() => setPickerOpen(false)}>
            {ALL_EMOJIS.map((e) => (
              <button key={e} onClick={() => react(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
