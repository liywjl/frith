import { useEffect, useState } from 'react';
import type { LibrarySourceDto } from '@app/shared';
import { api } from '../lib/api';
import { Modal } from './Modal';

/**
 * Folders and repos on this device that Ask can cite. Indexing is local-only:
 * nothing here is shared into the space.
 */
export function LibraryModal({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<LibrarySourceDto[]>([]);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.library().then(setSources).catch(console.error);
  }, []);

  async function add() {
    const trimmed = path.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.addLibrarySource(trimmed);
      setSources(await api.library());
      setPath('');
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\d+\s*/, '').replace(/^\{.*"error":"(.+?)".*\}$/, '$1') : 'Could not add that folder.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Library"
      subtitle="Folders and repos Ask can cite — indexed on this device, never shared into the space."
      onClose={onClose}
    >
      {sources.map((s) => (
        <div key={s.id} className="library-source">
          <div className="library-source-main">
            <b>{s.name}</b>
            <span className="library-path">{s.path}</span>
            <small>
              {s.fileCount} file{s.fileCount === 1 ? '' : 's'}
              {s.commitCount > 0 ? ` · ${s.commitCount} commits` : ''}
            </small>
          </div>
          <button
            className="btn"
            onClick={() => void api.removeLibrarySource(s.id).then(api.library).then(setSources)}
          >
            Remove
          </button>
        </div>
      ))}
      {sources.length === 0 && (
        <p className="library-empty">
          Point Lore at a codebase, docs folder, or notes directory — Ask will search it alongside your
          conversations.
        </p>
      )}

      <label className="field">
        <span>Add a folder</span>
        <input
          placeholder="/path/to/your/repo-or-docs"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
      </label>
      {error && <div className="form-error">{error}</div>}

      <div className="modal-actions">
        {sources.length > 0 && (
          <button className="btn" onClick={() => void api.reindexLibrary().then(setSources)}>
            Re-index all
          </button>
        )}
        <button className="btn primary" onClick={() => void add()} disabled={busy || !path.trim()}>
          {busy ? 'Indexing…' : 'Add to library'}
        </button>
      </div>
    </Modal>
  );
}
