import { useState } from 'react';
import { api } from '../lib/api';
import { suggestedHandle } from '../lib/handles';

export function StartSpaceForm({ placeholder, onDone, onBack }: { placeholder: boolean; onDone: () => void; onBack?: () => void }) {
  const [spaceName, setSpaceName] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalHandle = handle || suggestedHandle(name);
  const ready = spaceName.trim() !== '' && name.trim() !== '' && !pending;

  async function create() {
    if (!ready) return;
    setError(null);
    setPending(true);
    try {
      if (placeholder) {
        await api.createProfile({ name, handle: finalHandle });
        await api.patchSpace({ name: spaceName.trim() });
      } else {
        await api.createSpace(spaceName.trim());
        await api.createProfile({ name, handle: finalHandle });
      }
      onDone();
    } catch (err) {
      setPending(false);
      setError(err instanceof Error && err.message.includes('409') ? 'That handle is taken here.' : 'Could not create the space.');
    }
  }

  const onEnter = (e: { key: string }) => {
    if (e.key === 'Enter') void create();
  };

  return (
    <div className="login-create">
      <p className="login-first">Start a space and make yourself a profile in it.</p>
      <label className="field">
        <span>Space name</span>
        <input autoFocus value={spaceName} placeholder="e.g. Acme, Night Rollers, The Band" onChange={(e) => setSpaceName(e.target.value)} onKeyDown={onEnter} />
      </label>
      <label className="field">
        <span>Your name in it</span>
        <input
          value={name}
          placeholder="e.g. Mika Sørensen"
          onChange={(e) => {
            setName(e.target.value);
            if (!handleTouched) setHandle(suggestedHandle(e.target.value));
          }}
          onKeyDown={onEnter}
        />
      </label>
      <label className="field">
        <span>Handle</span>
        <input
          value={handle}
          placeholder="mika"
          onChange={(e) => {
            setHandleTouched(true);
            setHandle(e.target.value);
          }}
          onKeyDown={onEnter}
        />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="login-create-actions">
        {onBack && (
          <button className="btn login-back" onClick={onBack}>
            ← Back
          </button>
        )}
        <button className="btn primary" disabled={!ready} onClick={() => void create()}>
          {pending ? 'Setting up your space…' : `Create ${spaceName.trim() || 'your space'}`}
        </button>
      </div>
    </div>
  );
}
