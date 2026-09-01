import { useState } from 'react';
import { Icon } from './Icon';

export function UnverifiedBadge({ authorName }: { authorName: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  return (
    <>
      <button
        className="unverified-badge"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 270) });
        }}
      >
        <Icon name="warning" /> unverified
      </button>
      {pos && (
        <>
          <div className="status-pop-backdrop" onClick={() => setPos(null)} />
          <div className="status-pop" style={pos}>
            <div className="status-pop-h">Unverified message</div>
            <p className="space-hint">
              This was sent from a device that hasn't proven it belongs to {authorName}. Each person's devices are
              certified by their own identity key, and this one isn't — so it could be someone else writing under
              their name.
            </p>
            <p className="space-hint">
              To clear it, {authorName} can link this device from one they already use, or you can compare safety
              codes with them in person.
            </p>
          </div>
        </>
      )}
    </>
  );
}
