// Every profile gets its own banner: layered gradient "weather" derived
// deterministically from the handle, tinted by the person's accent (--ai is
// already re-scoped on the profile page). No images, no uploads, no storage —
// the same person looks the same on every device, forever.
import type { CSSProperties } from 'react';

export function bannerStyle(handle: string): CSSProperties {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  const x1 = 12 + (h % 61); // first blob: anywhere along the band
  const x2 = 90 - ((h >> 6) % 66); // second blob: roughly the other side
  const hue = (h >> 12) % 360; // companion colour, independent of accent
  const y2 = 20 + ((h >> 20) % 60);
  return {
    background: [
      `radial-gradient(220px 130px at ${x1}% 25%, color-mix(in oklab, var(--ai) 52%, transparent), transparent 70%)`,
      `radial-gradient(300px 170px at ${x2}% ${y2}%, hsl(${hue} 65% 72% / 0.55), transparent 72%)`,
      `linear-gradient(120deg, color-mix(in oklab, var(--ai) 30%, var(--paper)), var(--paper))`,
    ].join(', '),
  };
}
