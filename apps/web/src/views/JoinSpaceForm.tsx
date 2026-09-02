import { useState } from 'react';
import { api } from '../lib/api';

export function JoinSpaceForm({ onDone }: { onDone: () => void }) {
  const [invite, setInvite] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!invite.trim() || pending) return;
    setError(null);
    setPending(true);
    try {
      await api.joinSpace(invite.trim());
      onDone();
    } catch {
      setPending(false);
      setError('That invite did not work — check it with whoever sent it and try again.');
    }
  }

  return (
    <section className="login-create">
      <div className="login-list-h">Join a space with an invite</div>
      <p className="space-hint">
        Paste the invite someone shared with you. Your copy of their space syncs peer-to-peer, and you'll pick a
        name for yourself there.
      </p>
      <label className="field">
        <span>Invite</span>
        <div className="space-row">
          <input
            value={invite}
            placeholder="frith:…"
            onChange={(e) => setInvite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void join();
            }}
          />
          <button className="btn primary" disabled={!invite.trim() || pending} onClick={() => void join()}>
            {pending ? 'Joining…' : 'Join'}
          </button>
        </div>
      </label>
      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
