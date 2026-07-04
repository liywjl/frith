import { useState } from 'react';
import type { MessageDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { UserHover } from './UserHover';
import { useUserActions } from '../lib/userActions';

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
        {message.attachments.map((a) =>
          a.kind === 'image' ? (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
              <img className="att-img" src={a.url} alt={a.name} />
            </a>
          ) : a.kind === 'video' ? (
            <video key={a.id} className="att-video" src={a.url} controls />
          ) : a.kind === 'audio' ? (
            <audio key={a.id} className="att-audio" src={a.url} controls />
          ) : (
            <a key={a.id} className="att-file" href={a.url} target="_blank" rel="noreferrer">
              📎 {a.name}
            </a>
          ),
        )}
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
