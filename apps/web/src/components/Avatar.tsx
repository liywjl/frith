import { initials } from '../lib/format';

// Deterministic identity color: same name → same square, everywhere. The
// emoji prop is accepted (profiles still carry one as flair) but no longer
// rendered here — avatars are colored squares with initials.
export const hueOf = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
};

export function Avatar({ name }: { name: string; emoji?: string | null }) {
  const hue = hueOf(name);
  return (
    <div className="avatar" style={{ background: `hsl(${hue} 45% 85%)`, color: `hsl(${hue} 50% 30%)` }}>
      {initials(name)}
    </div>
  );
}
