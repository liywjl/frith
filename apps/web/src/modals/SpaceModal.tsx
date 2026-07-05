import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { SpaceDto } from '@app/shared';
import { api } from '../lib/api';
import { Modal } from './Modal';

export function SpaceModal({
  space,
  onSpaceChange,
  onClose,
  mode = 'share',
}: {
  space: SpaceDto | null;
  onSpaceChange: (space: SpaceDto) => void;
  onClose: () => void;
  /** 'share': show this space's invite. 'new': create/join another space. */
  mode?: 'share' | 'new';
}) {
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (space) QRCode.toDataURL(space.invite, { margin: 1, width: 220 }).then(setQr);
  }, [space]);

  async function run(action: () => Promise<SpaceDto>) {
    setBusy(true);
    setError(null);
    try {
      onSpaceChange(await action());
    } catch {
      setError('That did not work — check the invite and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (space && mode === 'share') {
    const mailto = `mailto:?subject=${encodeURIComponent(`Join "${space.name}" on Lore`)}&body=${encodeURIComponent(
      `Join my Lore space "${space.name}" — paste this invite into Lore:\n\n${space.invite}\n\nLore is peer-to-peer: your copy of the workspace lives on your machine.`,
    )}`;
    return (
      <Modal
        title={space.name}
        subtitle={`P2P space · ${space.connectedPeers} peer${space.connectedPeers === 1 ? '' : 's'} connected`}
        onClose={onClose}
      >
        <div className="space-share">
          {qr && <img className="space-qr" src={qr} alt="Invite QR code" />}
          <div className="space-share-right">
            <p className="space-hint">
              Anyone with this invite can join — it's the key, so share it like a password.
            </p>
            <input className="space-invite" readOnly value={space.invite} onFocus={(e) => e.target.select()} />
            <div className="space-actions">
              <button
                className="btn primary"
                onClick={() => {
                  void navigator.clipboard.writeText(space.invite);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied ✓' : 'Copy invite'}
              </button>
              <a className="btn" href={mailto}>
                Email it
              </a>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Spaces"
      subtitle="A space connects people peer-to-peer — it lives on its members' devices, nowhere else. Start one, or join with an invite someone shared with you."
      onClose={onClose}
    >
      <label className="field">
        <span>Create a space</span>
        <div className="space-row">
          <input
            value={name}
            placeholder="e.g. acme-hq"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void run(() => api.createSpace(name.trim()));
            }}
          />
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void run(() => api.createSpace(name.trim()))}>
            Create
          </button>
        </div>
      </label>
      <label className="field">
        <span>Or join with an invite</span>
        <div className="space-row">
          <input
            value={invite}
            placeholder="lore:…"
            onChange={(e) => setInvite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && invite.trim()) void run(() => api.joinSpace(invite.trim()));
            }}
          />
          <button className="btn primary" disabled={busy || !invite.trim()} onClick={() => void run(() => api.joinSpace(invite.trim()))}>
            Join
          </button>
        </div>
      </label>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
