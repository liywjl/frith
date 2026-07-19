// A square photo tile: cached images preview on click; uncached ones show a
// fetch chip that pulls the bytes from whichever peer holds them (P2P — the
// bytes may not be here yet). Used by the feed and the profile photo wall.
import { useState } from 'react';
import type { AttachmentDto } from '@app/shared';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { FilePreviewModal } from '../modals/FilePreviewModal';

export function PhotoThumb({ photo }: { photo: AttachmentDto }) {
  const [cached, setCached] = useState(photo.cached);
  const [state, setState] = useState<'idle' | 'fetching' | 'failed'>('idle');
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!cached) {
    return (
      <button
        className="photo-thumb photo-fetch"
        disabled={state === 'fetching'}
        title={photo.name}
        onClick={() => {
          setState('fetching');
          api
            .fetchFile(photo.id)
            .then(() => setCached(true))
            .catch(() => setState('failed'));
        }}
      >
        <Icon name="download" size={18} />
        <small>{state === 'fetching' ? 'fetching…' : state === 'failed' ? 'no peer online' : 'fetch'}</small>
      </button>
    );
  }

  return (
    <>
      <button className="photo-thumb" title={photo.name} onClick={() => setPreviewOpen(true)}>
        <img src={photo.url} alt={photo.name} loading="lazy" />
      </button>
      {previewOpen && (
        <FilePreviewModal attachment={{ ...photo, cached: true }} kind="image" onClose={() => setPreviewOpen(false)} />
      )}
    </>
  );
}
