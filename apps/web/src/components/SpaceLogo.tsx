import type { SpaceDto } from '@app/shared';
import { initials } from '../lib/format';

// The space's visual identity: its uploaded logo if it has one, else a
// deterministic colored square with the space's initials — same convention as
// user avatars, so an unbranded space still reads as itself.
const hueOf = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
};

export function SpaceLogo({ space, large = false }: { space: SpaceDto; large?: boolean }) {
  const cls = `space-logo${large ? ' space-logo-lg' : ''}`;
  if (space.logoUrl) return <img className={cls} src={space.logoUrl} alt={`${space.name} logo`} />;
  const hue = hueOf(space.name);
  return (
    <div className={cls} style={{ background: `hsl(${hue} 45% 85%)`, color: `hsl(${hue} 50% 30%)` }}>
      {initials(space.name)}
    </div>
  );
}
