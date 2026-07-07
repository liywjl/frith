import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

/** Link another device: show this identity's handoff code (the root seed —
 *  it IS your account, so it moves between your devices out of band only). */
export function DevicesModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.exportIdentity().then((r) => setCode(r.code)).catch(() => setError(true));
  }, []);

  return (
    <Modal title="Link another device" onClose={onClose}>
      {error ? (
        <p className="modal-empty">
          This device doesn't hold your identity seed — export from the device you created your profile on.
        </p>
      ) : (
        <>
          <p className="modal-empty">
            On your other device, join this space with the invite, then choose “Link this one” and paste this code.
            Treat it like a password — it is your identity. If a device is lost, revoke it from a device that has
            this code.
          </p>
          <code className="devices-code">{code ?? '…'}</code>
          <div className="modal-actions">
            <button
              className="btn primary"
              disabled={!code}
              onClick={() => {
                void navigator.clipboard.writeText(code!);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
