// Text with live @handles: any @mention that resolves to a real person
// becomes a link to their profile — how bios, posts, and comments interlink.
import { useUserActions } from '../lib/userActions';

const MENTION_RE = /(@[a-z0-9-_.]+)/gi;

export function Mentions({ text }: { text: string }) {
  const { userByHandle, openProfile } = useUserActions();
  return (
    <>
      {text.split(MENTION_RE).map((part, i) => {
        if (part.startsWith('@')) {
          // Handles may legitimately contain . - _ but sentences end in them
          // too ("thanks @june.") — prefer the exact handle, then retry with
          // trailing punctuation shed.
          const core = part.replace(/[._-]+$/, '');
          const match = userByHandle(part.slice(1).toLowerCase()) ?? userByHandle(core.slice(1).toLowerCase());
          if (match) {
            const rest = `@${match.handle}`.length < part.length ? part.slice(`@${match.handle}`.length) : '';
            return (
              <span key={i}>
                <button className="mention" title={match.name} onClick={() => openProfile(match.id)}>
                  @{match.handle}
                </button>
                {rest}
              </span>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
