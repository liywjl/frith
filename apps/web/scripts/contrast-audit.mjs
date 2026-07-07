// Theme contrast audit — a dependency-free WCAG 2.1 check over every theme's
// token pairings. Run: `npm run check:contrast` (from apps/web).
//
// Why home-grown instead of a package: our themes live as CSS custom properties
// in styles.css, so we parse those directly and assert the pairs that actually
// render (button text on button fill, etc.). Critical pairs must clear AA 4.5 or
// the script exits non-zero (CI-friendly); muted/secondary text is reported as a
// warning since ~3:1 de-emphasis is a deliberate design choice, not a bug.
import fs from 'node:fs';
import path from 'node:path';

const cssPath = path.join(import.meta.dirname, '..', 'src', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

const THEMES = ['ocean', 'bubbly', 'paper', 'midnight', 'forest', 'sunset', 'mono'];

// Parse :root (base, = ocean defaults) and every [data-theme='x'] block.
let base = {};
const byName = {};
const re = /(:root|\[data-theme='([a-z]+)'\])\s*\{([^}]*)\}/g;
for (let m; (m = re.exec(css)); ) {
  const vars = {};
  for (const v of m[3].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})/g)) vars[v[1]] = v[2];
  if (m[1] === ':root') base = { ...base, ...vars };
  else byName[m[2]] = { ...(byName[m[2]] ?? {}), ...vars };
}

const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (c) => ((c /= 255), c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

const AA = 4.5;
// [fg, bg, description, critical?]
const PAIRS = [
  ['ink', 'paper', 'body text', true],
  ['ink', 'card', 'text on cards & buttons', true],
  ['ink', 'side', 'sidebar text', true],
  ['on-ai', 'ai', 'primary button text', true],
  ['ai', 'ai-soft', 'accent (secondary) button', true],
  ['ai', 'card', 'accent links on cards', true],
  ['ai', 'paper', 'accent links on page', true],
  ['ink-soft', 'paper', 'muted text', false],
  ['ink-soft', 'card', 'muted text on cards', false],
];

let criticalFails = 0;
let warnings = 0;
for (const t of THEMES) {
  const v = { ...base, ...(byName[t] ?? {}) };
  const lines = [];
  for (const [fg, bg, what, critical] of PAIRS) {
    if (!v[fg] || !v[bg]) continue;
    const r = ratio(v[fg], v[bg]);
    if (r >= AA) { lines.push(`  ok    ${r.toFixed(2)}  ${what}`); continue; }
    if (critical) { criticalFails++; lines.push(`  FAIL  ${r.toFixed(2)}  ${what}  (${fg} ${v[fg]} on ${bg} ${v[bg]})`); }
    else { warnings++; lines.push(`  warn  ${r.toFixed(2)}  ${what}  (${fg} ${v[fg]} on ${bg} ${v[bg]})`); }
  }
  console.log(`\n${t}`);
  console.log(lines.join('\n'));
}

console.log(`\n${criticalFails} critical failure(s), ${warnings} warning(s) against WCAG AA (${AA}:1).`);
if (criticalFails > 0) process.exit(1);
