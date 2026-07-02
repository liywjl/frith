import type { MessageDto } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';

const EMOJIS = ['👍', '❤️', '✅', '😂', '🎉', '👀'];

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function Message({
  message,
  compact,
  onOpenThread,
  onOpenProfile,
}: {
  message: MessageDto;
  /** Consecutive message from the same author — hide the avatar/header. */
  compact?: boolean;
  onOpenThread?: (root: MessageDto) => void;
  onOpenProfile?: (userId: string) => void;
}) {
  return (
    <div className={`msg ${compact ? 'compact' : ''}`}>
      {compact ? (
        <div className="msg-gutter">{timeFormat.format(new Date(message.createdAt))}</div>
      ) : (
        <Avatar name={message.authorName} emoji={message.authorAvatarEmoji} />
      )}
      <div className="msg-main">
        {!compact && (
          <div>
            {onOpenProfile ? (
              <button className="who who-link" onClick={() => onOpenProfile(message.authorId)}>
                {message.authorName}
              </button>
            ) : (
              <span className="who">{message.authorName}</span>
            )}
            <span className="when">{timeFormat.format(new Date(message.createdAt))}</span>
          </div>
        )}
        <div className="body">{message.body}</div>
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
        {EMOJIS.map((e) => (
          <button key={e} title={`React ${e}`} onClick={() => void api.react(message.id, e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
