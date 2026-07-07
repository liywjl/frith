// File-safety decisions happen at the edges: on upload we trust the bytes,
// not the declared mime (a .png that isn't a PNG renders as a plain file);
// on display we flag types that could execute if opened carelessly.

const MAGIC: { mime: string; test(b: Buffer): boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'audio/mpeg', test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  { mime: 'audio/wav', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/**
 * The mime we act on. When the declared type claims to be renderable
 * (image/video/audio, or a PDF — the client previews those), the bytes must
 * actually look like that — otherwise the file is demoted to a generic
 * download, never rendered.
 */
export function effectiveMime(bytes: Buffer, declaredMime: string): string {
  const sniffed = MAGIC.find((m) => m.test(bytes))?.mime;
  const family = (m: string) => m.split('/')[0];
  if (declaredMime === 'application/pdf') {
    return sniffed === 'application/pdf' ? sniffed : 'application/octet-stream';
  }
  const declaredRenders = ['image', 'video', 'audio'].includes(family(declaredMime) ?? '');
  if (!declaredRenders) return declaredMime; // plain files: declared is fine, we never render them
  // WebM is one container for both: audio-only recordings sniff as video/webm,
  // so the declared side of the family split is the honest one.
  if (sniffed === 'video/webm' && family(declaredMime) === 'audio') return 'audio/webm';
  if (!sniffed || family(sniffed) !== family(declaredMime)) return 'application/octet-stream';
  return sniffed;
}

const DANGEROUS_EXT = new Set([
  'exe', 'dll', 'msi', 'scr', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jse', 'wsf',
  'jar', 'apk', 'app', 'dmg', 'pkg', 'sh', 'command', 'desktop', 'lnk', 'html', 'htm', 'svg',
]);

/** Could this execute (or script a browser) if opened carelessly? */
export function isDangerousName(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return DANGEROUS_EXT.has(ext);
}
