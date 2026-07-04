/** The Lore mark: a campfire flame — where the stories get told. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Lore" role="img">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--ai)" />
      <path
        d="M16.5 5.5c.6 3.4 5.6 5.6 5.6 11a6.1 6.1 0 1 1-12.2 0c0-2.9 1.8-4.4 2.8-7 .9 1.6 2.4 2.3 2.6 4.4 1-1.2 1.4-2.7 1.2-4.6z"
        fill="var(--paper)"
        opacity="0.95"
      />
      <circle cx="16" cy="19.5" r="2.6" fill="var(--ai)" opacity="0.55" />
    </svg>
  );
}
