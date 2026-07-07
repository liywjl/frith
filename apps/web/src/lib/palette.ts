// Palette experiments: map a 4-colour combo (from the Figma reference set)
// onto the app's theme variables, live. This is a try-on tool — a combo that
// earns its keep graduates into a real [data-theme] block in styles.css.
import combos from './palettes.json';

export interface Combo {
  name: string;
  cat: string;
  colors: string[];
}

export const COMBOS: Combo[] = combos;

const STORAGE_KEY = 'frith-palette';

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const saturation = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!);
  return max === 0 ? 0 : (max - min) / max;
};

/**
 * Assign roles by lightness, then guarantee text contrast. The lightest and
 * darkest colours anchor the surfaces; the most saturated middle colour is the
 * accent. Crucially, ink is chosen against the *actual* surface: light surfaces
 * get near-black ink, dark surfaces flip to near-white — so text is never faint.
 * Muted text and hairlines are derived from --ink mixed toward --paper by a
 * fixed, readable ratio, rather than washed toward white (which is what faded).
 */
function paletteVars(colors: string[]): Record<string, string> {
  const byLight = [...colors].sort((a, b) => luminance(b) - luminance(a));
  const lightest = byLight[0]!;
  const darkest = byLight[byLight.length - 1]!;
  const mids = byLight.slice(1, -1);
  const accent = [...mids].sort((a, b) => saturation(b) - saturation(a))[0] ?? darkest;
  const mix = (c: string, pct: number, base = 'white') => `color-mix(in srgb, ${c} ${pct}%, ${base})`;
  // Muted text / hairlines: blend the (already bold) ink toward the surface by a
  // fixed ratio so they stay legible on whatever background the combo produced.
  const onPaper = (pct: number) => `color-mix(in srgb, var(--ink) ${pct}%, var(--paper))`;

  // If even the brightest colour is dark, the app can't carry dark text — go
  // dark-mode: deep surfaces, light ink. Otherwise pale surfaces, near-black ink.
  const dark = luminance(lightest) < 0.5;

  if (dark) {
    return {
      '--paper': mix(darkest, 70, 'black'),
      '--card': mix(darkest, 88, 'black'),
      '--side': mix(darkest, 55, 'black'),
      '--block': darkest,
      '--hover': mix(darkest, 96, 'black'),
      '--line': onPaper(24),
      '--line-soft': onPaper(12),
      '--ink': mix(lightest, 92), // near-white, keeps a hint of the palette
      '--ink-soft': onPaper(62),
      '--ai': mix(accent, 60), // lift the accent so it reads on a dark ground
      '--ai-soft': mix(accent, 26, 'black'),
      '--ai-hover': mix(accent, 74),
      '--unread': mix(accent, 60),
      '--rail': mix(darkest, 50, 'black'),
    };
  }
  return {
    '--paper': mix(lightest, 22),
    '--card': mix(lightest, 10),
    '--side': mix(lightest, 45),
    '--block': mix(lightest, 60),
    '--hover': mix(lightest, 38),
    '--line': onPaper(20),
    '--line-soft': onPaper(10),
    '--ink': mix(darkest, 90, 'black'), // bold, near-black
    '--ink-soft': onPaper(58),
    '--ai': accent,
    '--ai-soft': mix(accent, 16),
    '--ai-hover': mix(accent, 28),
    '--unread': accent,
    '--rail': darkest,
  };
}

export function applyPalette(combo: Combo | null): void {
  const root = document.documentElement;
  for (const key of Object.keys(paletteVars(['#000000', '#888888', '#CCCCCC', '#FFFFFF']))) {
    root.style.removeProperty(key);
  }
  if (combo) {
    for (const [key, value] of Object.entries(paletteVars(combo.colors))) root.style.setProperty(key, value);
    localStorage.setItem(STORAGE_KEY, combo.name);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function activePaletteName(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
