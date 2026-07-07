import { useEffect, useState } from 'react';
import type { AttachmentDto } from '@app/shared';
import { Icon } from '../components/Icon';
import { Modal } from './Modal';
import type { PreviewKind } from '../lib/preview';

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Text bigger than this reads better in a real editor — offer the download. */
const TEXT_PREVIEW_MAX = 2 * 1024 * 1024;

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);

  if (failed) return <p className="preview-note">Couldn't load the file — try downloading it instead.</p>;
  if (text === null) return <p className="preview-note">Loading…</p>;
  // Rendered as text, never interpreted — React escapes, so even a file full
  // of <script> tags is just characters on screen.
  return <pre className="preview-text">{text}</pre>;
}

function PdfPreview({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The server serves files as downloads (content-disposition: attachment),
  // which is right for links — so for preview we fetch the bytes ourselves
  // and hand a typed blob to the browser's sandboxed PDF viewer.
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        created = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
        if (alive) setBlobUrl(created);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  if (failed) return <p className="preview-note">Couldn't load the file — try downloading it instead.</p>;
  if (!blobUrl) return <p className="preview-note">Loading…</p>;
  return <iframe className="preview-frame" src={blobUrl} title="PDF preview" />;
}

/** Click-to-preview for safe, common formats. Everything else downloads. */
export function FilePreviewModal({
  attachment: a,
  kind,
  onClose,
}: {
  attachment: AttachmentDto;
  kind: PreviewKind;
  onClose: () => void;
}) {
  return (
    <Modal
      title={a.name}
      subtitle={
        <>
          {fmtSize(a.size)} ·{' '}
          <a className="preview-download" href={a.url} download={a.name}>
            <Icon name="download" /> Download
          </a>
        </>
      }
      onClose={onClose}
    >
      <div className="preview-body">
        {kind === 'image' && <img className="preview-img" src={a.url} alt={a.name} />}
        {kind === 'video' && <video className="preview-media" src={a.url} controls autoPlay />}
        {kind === 'audio' && <audio className="preview-audio" src={a.url} controls autoPlay />}
        {kind === 'pdf' && <PdfPreview url={a.url} />}
        {kind === 'text' &&
          (a.size > TEXT_PREVIEW_MAX ? (
            <p className="preview-note">This file is {fmtSize(a.size)} — too big to preview comfortably. Download it instead.</p>
          ) : (
            <TextPreview url={a.url} />
          ))}
      </div>
    </Modal>
  );
}
