import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

/**
 * Fingerprint verification (HARDENING §6): both people see the same digits,
 * derived from their root identity keys — read them to each other in person
 * or on a call, and mark the contact verified. The mark lives on this device
 * only, and silently drops if the contact's identity key ever changes.
 * Renders nothing when either side has no root identity (dev demo users).
 */
export function SafetyCode({ userId }: { userId: string }) {
  const [state, setState] = useState<{ code: string | null; verified: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .contactFingerprint(userId)
      .then((s) => alive && setState(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!state?.code) return null;

  const toggle = () =>
    void api
      .setContactVerified(userId, !state.verified)
      .then(setState)
      .catch(() => {});
  return (
    <div className="panel-card">
      <div className="panel-h">Safety code</div>
      <div className="safety-code">{state.code}</div>
      <span className="safety-hint">
        You both see the same digits. Compare them in person or on a call, then mark verified.
      </span>
      <button className={`btn safety-verify ${state.verified ? 'on' : ''}`} onClick={toggle}>
        <Icon name={state.verified ? 'check' : 'lock'} /> {state.verified ? 'Verified' : 'Mark as verified'}
      </button>
    </div>
  );
}
