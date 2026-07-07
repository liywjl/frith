/** The Frith mark: an enclosure holding one point — a protected space that's yours.
 *  Colours track the active theme: accent enclosure (--ai) so the badge always
 *  contrasts with the sidebar, and frame + point in --on-ai — the foreground the
 *  contrast audit guarantees is legible on the accent, in light and dark themes
 *  alike. Set via `style` so the CSS custom properties resolve. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Frith" role="img">
      <rect x="1" y="1" width="30" height="30" rx="9" style={{ fill: 'var(--ai)' }} />
      <rect x="7" y="7" width="18" height="18" rx="5" fill="none" style={{ stroke: 'var(--on-ai)' }} strokeWidth="2.4" />
      <circle cx="16" cy="16" r="3.2" style={{ fill: 'var(--on-ai)' }} />
    </svg>
  );
}
