import { useEffect, useState } from 'react';
import type { PoliciesDto, StorageDto } from '@app/shared';
import { api } from '../lib/api';
import { Modal } from './Modal';

const FIELDS: { key: keyof PoliciesDto; label: string; help: string }[] = [
  { key: 'maxUploadMB', label: 'Max upload (MB)', help: 'Bigger uploads are rejected on this device' },
  { key: 'autoFetchMB', label: 'Auto-download up to (MB)', help: 'Files at or under this size arrive on their own' },
  { key: 'autoFetchRecentDays', label: 'Auto-download newer than (days)', help: 'Older files wait for a click' },
  { key: 'storageBudgetMB', label: 'Cache budget (MB)', help: 'Peers’ files evict oldest-first beyond this' },
];

const fmtMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Device-local storage policies — what THIS machine stores and downloads. */
export function StorageModal({ onClose }: { onClose: () => void }) {
  const [storage, setStorage] = useState<StorageDto | null>(null);
  const [draft, setDraft] = useState<PoliciesDto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .storage()
      .then((s) => {
        setStorage(s);
        setDraft(s.policies);
      })
      .catch(console.error);
  }, []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api.setPolicies(draft);
      setStorage(next);
      setDraft(next.policies);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Storage"
      subtitle="Your policies, your device — these settings never leave this machine."
      onClose={onClose}
    >
      {draft && storage && (
        <>
          {FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span>
                {f.label} <em className="field-help">{f.help}</em>
              </span>
              <input
                type="number"
                min={0}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
              />
            </label>
          ))}
          {storage.keyCustody === 'file' && (
            <p className="field-help">
              This machine has no OS keychain available, so Frith’s master key lives in a file only your
              user account can read — not in the system keychain. Anything that can read your files can
              read this space’s data at rest.
            </p>
          )}
          <div className="storage-usage">
            Cached from peers: <b>{fmtMB(storage.usage.cachedBytes)}</b> in {storage.usage.cachedCount}{' '}
            file{storage.usage.cachedCount === 1 ? '' : 's'}
            <button
              className="btn"
              onClick={() => void api.clearFileCache().then(setStorage)}
              disabled={storage.usage.cachedCount === 0}
            >
              Clear cache
            </button>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
