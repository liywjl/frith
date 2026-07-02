import type { MessageDto } from '@app/shared';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function Message({
  message,
  onOpenThread,
}: {
  message: MessageDto;
  onOpenThread?: (root: MessageDto) => void;
}) {
  return (
    <div className="msg">
      <div className="avatar">{initials(message.authorName)}</div>
      <div className="msg-main">
        <div>
          <span className="who">{message.authorName}</span>
          <span className="when">{timeFormat.format(new Date(message.createdAt))}</span>
        </div>
        <div className="body">{message.body}</div>
        {onOpenThread && (
          <button className="thread-pill" onClick={() => onOpenThread(message)}>
            {message.replyCount > 0 ? `↳ ${message.replyCount} replies` : 'Reply in thread'}
          </button>
        )}
      </div>
    </div>
  );
}
