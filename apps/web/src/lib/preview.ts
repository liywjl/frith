// What can pop open safely on click. The rule: preview only content the
// browser renders inertly — pixels, players, the sandboxed PDF viewer, or
// bytes we show AS text (never interpreted). Anything dangerous-flagged
// (executables, html/svg — they script the browser) or obscure stays a
// download, and uncached bytes must be fetched from a peer first.
import type { AttachmentDto } from '@app/shared';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

// Extension fallback for text: browsers often upload .md/.log/etc with an
// empty mime. Safe regardless of real content — text preview renders bytes
// as characters, so a mislabeled binary just looks like noise.
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json',
  'yaml', 'yml', 'toml', 'ini', 'xml', 'patch', 'diff',
]);

export function previewKind(a: AttachmentDto): PreviewKind | null {
  if (a.dangerous || !a.cached) return null;
  if (a.kind !== 'file') return a.kind; // image/video/audio — byte-verified by the server
  if (a.mime === 'application/pdf') return 'pdf'; // ditto
  const ext = a.name.toLowerCase().split('.').pop() ?? '';
  if (a.mime.startsWith('text/') || a.mime === 'application/json' || TEXT_EXT.has(ext)) return 'text';
  return null;
}
