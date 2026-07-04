import { useRef, useState, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { useUserActions } from '../lib/userActions';

const CARD_WIDTH = 260;
const CARD_HEIGHT = 150;

/**
 * Wrap anything that represents a person: hovering reveals a card with who
 * they are plus one-click Message / Profile actions. The wrapped element
 * keeps its own click behavior, so chatting never costs an extra click.
 */
export function UserHover({ userId, name, children }: { userId: string; name: string; children: ReactNode }) {
  const { openDm, openProfile, getUser, isOnline } = useUserActions();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const enterTimer = useRef<number>(0);
  const leaveTimer = useRef<number>(0);

  function show() {
    window.clearTimeout(leaveTimer.current);
    enterTimer.current = window.setTimeout(() => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8));
      const below = rect.bottom + 6;
      const y = below + CARD_HEIGHT > window.innerHeight ? rect.top - CARD_HEIGHT - 6 : below;
      setPos({ x, y });
    }, 350);
  }

  function hide() {
    window.clearTimeout(enterTimer.current);
    leaveTimer.current = window.setTimeout(() => setPos(null), 200);
  }

  const user = getUser(userId);
  const display = user?.name ?? name;

  return (
    <span className="uh-wrap" ref={wrapRef} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos && (
        <div
          className="hovercard"
          style={{ left: pos.x, top: pos.y }}
          onMouseEnter={() => window.clearTimeout(leaveTimer.current)}
          onMouseLeave={hide}
        >
          <div className="hovercard-top">
            <Avatar name={display} emoji={user?.avatarEmoji} />
            <div className="hovercard-id">
              <b>
                {display} {user?.statusEmoji && <span title={user.statusText ?? undefined}>{user.statusEmoji}</span>}
              </b>
              <span>
                {[user?.title, user?.team].filter(Boolean).join(' · ') || (user ? `@${user.handle}` : '')}
              </span>
              <span className={`presence-inline ${isOnline(userId) ? 'on' : ''}`}>
                {isOnline(userId) ? 'online' : 'offline'}
              </span>
            </div>
          </div>
          {user?.nowPlaying && <div className="hovercard-now">🎧 {user.nowPlaying}</div>}
          <div className="hovercard-actions">
            <button
              className="btn primary"
              onClick={() => {
                setPos(null);
                openDm(userId);
              }}
            >
              Message
            </button>
            <button
              className="btn"
              onClick={() => {
                setPos(null);
                openProfile(userId);
              }}
            >
              Profile
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
