import { memo, useState } from 'react';
import type { AttachmentDto, MessageDto } from '@app/shared';
import { api } from '../lib/api';
import { previewKind } from '../lib/preview';
import { FilePreviewModal } from '../modals/FilePreviewModal';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = previewKind(a);

  if (a.dangerous) {
    return (
      <a className="att-file att-danger" href={a.url} download title="This file type can run code. Only open it if you trust the sender.">
        <Icon name="warning" /> {a.name} · {fmtSize(a.size)}
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
        {state === 'fetching' ? (
          <><Icon name="clock" /> fetching from peers…</>
        ) : state === 'failed' ? (
          <><Icon name="signal" /> no peer online has this — retry?</>
        ) : (
          <><Icon name="download" /> {a.name} · {fmtSize(a.size)}</>
        )}
      </button>
    );
  }
  const modal = previewOpen && preview && (
    <FilePreviewModal attachment={a} kind={preview} onClose={() => setPreviewOpen(false)} />
  );
  if (a.kind === 'image') {
    return (
      <>
        <button className="att-img-btn" title="Click to preview" onClick={() => setPreviewOpen(true)}>
          <img className="att-img" src={a.url} alt={a.name} loading="lazy" />
        </button>
        {modal}
      </>
    );
  }
  if (a.kind === 'video') return <video className="att-video" src={a.url} controls />;
  if (a.kind === 'audio') return <audio className="att-audio" src={a.url} controls />;
  // Common, inert formats (pdf, text) preview in place; anything obscure
  // stays a download — the safe default.
  if (preview) {
    return (
      <>
        <button className="att-file" title="Click to preview" onClick={() => setPreviewOpen(true)}>
          <Icon name="paperclip" /> {a.name} · {fmtSize(a.size)}
        </button>
        {modal}
      </>
    );
  }
  return (
    <a className="att-file" href={a.url} download={a.name}>
      <Icon name="paperclip" /> {a.name} · {fmtSize(a.size)}
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

// Memoized: a thousand-message feed re-renders one bubble on a reaction, not
// a thousand. Message DTOs are replaced (not mutated) on change upstream.
export const Message = memo(function Message({
  message,
  compact,
  own,
  onOpenThread,
}: {
  message: MessageDto;
  /** Consecutive message from the same author — hide the avatar/header. */
  compact?: boolean;
  /** Mine: right-aligned, no avatar/name — the room's other voices sit left. */
  own?: boolean;
  onOpenThread?: (root: MessageDto) => void;
}) {
  const { openProfile } = useUserActions();
  const [pickerOpen, setPickerOpen] = useState(false);

  function react(emoji: string) {
    setPickerOpen(false);
    void api.react(message.id, emoji);
  }
  return (
    <div className={`msg ${compact ? 'compact' : ''} ${own ? 'own' : ''}`}>
      {own ? null : compact ? (
        <div className="msg-gutter">{timeFormat.format(new Date(message.createdAt))}</div>
      ) : (
        <button
          className="avatar-link"
          title={`${message.authorName}'s profile`}
          onClick={() => openProfile(message.authorId)}
        >
          <Avatar name={message.authorName} emoji={message.authorAvatarEmoji} />
        </button>
      )}
      <div className="msg-main">
        {!compact && (
          <div className="msg-head">
            {!own && (
              <button className="who who-link" onClick={() => openProfile(message.authorId)}>
                {message.authorName}
              </button>
            )}
            <span className="when">{timeFormat.format(new Date(message.createdAt))}</span>
          </div>
        )}
        {message.locked ? (
          <div className="body bubble locked">
            <Icon name="lock" /> {message.body}
          </div>
        ) : (
          message.body && <div className="body bubble">{message.body}</div>
        )}
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
});
