import { useEffect, useState } from 'react';
import type { FileDto } from '@app/shared';
import { api } from '../lib/api';

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵', file: '📄' } as const;

function FileTile({ file, onOpenChannel }: { file: FileDto; onOpenChannel: (channelId: string) => void }) {
  const [state, setState] = useState<'idle' | 'fetching' | 'failed'>('idle');
  const [cached, setCached] = useState(file.cached);

  function fetchNow() {
    setState('fetching');
    api
      .fetchFile(file.id)
      .then(() => setCached(true))
      .catch(() => setState('failed'));
  }

  return (
    <div className={`file-tile ${file.dangerous ? 'danger' : ''}`}>
      {cached && file.kind === 'image' && !file.dangerous ? (
        <a className="file-thumb" href={file.url} target="_blank" rel="noreferrer">
          <img src={file.url} alt={file.name} loading="lazy" />
        </a>
      ) : (
        <div className="file-thumb file-icon">{file.dangerous ? '⚠️' : KIND_ICON[file.kind]}</div>
      )}
      <div className="file-meta">
        {cached && !file.dangerous ? (
          <a className="file-name" href={file.url} target="_blank" rel="noreferrer">
            {file.name}
          </a>
        ) : cached ? (
          <a className="file-name" href={file.url} download title="This file type can run code — only open it if you trust the sender.">
            {file.name}
          </a>
        ) : (
          <button className="file-name file-fetch" onClick={fetchNow} disabled={state === 'fetching'}>
            {state === 'fetching' ? 'fetching…' : state === 'failed' ? 'no peer online — retry?' : `⬇ ${file.name}`}
          </button>
        )}
        <small>
          {fmtSize(file.size)} · {file.authorName} ·{' '}
          <button className="file-channel" onClick={() => onOpenChannel(file.channelId)}>
            #{file.channelName}
          </button>{' '}
          · {dateFormat.format(new Date(file.createdAt))}
        </small>
      </div>
    </div>
  );
}

/** Every file shared in channels you can read — the space's shelf. */
export function FilesView({ onOpenChannel }: { onOpenChannel: (channelId: string) => void }) {
  const [files, setFiles] = useState<FileDto[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.files().then(setFiles).catch(console.error);
  }, []);

  const shown = (files ?? []).filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="files-view">
      <header className="view-head">
        <div>
          <h2>Files</h2>
          <p>Everything shared in this space that you can see. Bytes stay with peers until you fetch them.</p>
        </div>
        <input
          className="files-filter"
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>
      <div className="file-grid">
        {shown.map((f) => (
          <FileTile key={f.id} file={f} onOpenChannel={onOpenChannel} />
        ))}
      </div>
      {files !== null && shown.length === 0 && (
        <p className="files-empty">
          {files.length === 0 ? 'Nothing shared yet — drop a file into any channel.' : 'No file matches that filter.'}
        </p>
      )}
    </div>
  );
}
