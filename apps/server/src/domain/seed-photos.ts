// Procedural "photos" for the seed corpora: deterministic abstract gradient
// shots, generated at seed time so the demo feed and profile photo walls have
// real images without binary fixtures in the repo. Dependency-free PNG writer
// (stored deflate, hand-rolled checksums) — no node:zlib, because seeding
// also runs inside the mobile worklet.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const be32 = (n: number): Uint8Array =>
  new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = concat([new TextEncoder().encode(type), data]);
  return concat([be32(data.length), typed, be32(crc32(typed))]);
};

/** A zlib stream of stored (uncompressed) deflate blocks. */
const deflateStored = (raw: Uint8Array): Uint8Array => {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let at = 0; at < raw.length; at += 65535) {
    const block = raw.subarray(at, Math.min(at + 65535, raw.length));
    const last = at + 65535 >= raw.length ? 1 : 0;
    const len = block.length;
    parts.push(new Uint8Array([last, len & 0xff, len >> 8, ~len & 0xff, (~len >> 8) & 0xff]), block);
  }
  parts.push(be32(adler32(raw)));
  return concat(parts);
};

/** Deterministic PRNG seeded from a string — same name, same photo, always. */
const rng = (seed: string): (() => number) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};

/** One frame of gradient-with-sun scenery as RGB bytes (no filter bytes). */
function scene(rand: () => number, w: number, h: number, drift = 0): { rgb: Uint8Array; grainy: () => number } {
  const hueA = rand() * 360;
  const hueB = (hueA + 30 + rand() * 60) % 360;
  const top = hslToRgb((hueA + drift * 12) % 360, 0.55, 0.62);
  const bottom = hslToRgb((hueB + drift * 12) % 360, 0.5, 0.28);
  const sunX = w * (0.2 + rand() * 0.6) + drift * w * 0.04;
  const sunY = h * (0.2 + rand() * 0.4) + Math.sin(drift) * h * 0.03;
  const sunR = h * (0.15 + rand() * 0.2);
  const sun = hslToRgb((hueA + 15) % 360, 0.75, 0.85);

  const rgb = new Uint8Array(w * h * 3);
  let at = 0;
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - sunX, y - sunY);
      const glow = Math.max(0, 1 - d / sunR) ** 2;
      const grain = (rand() - 0.5) * 14;
      for (let c = 0; c < 3; c++) {
        const base = top[c]! + (bottom[c]! - top[c]!) * t;
        rgb[at++] = Math.max(0, Math.min(255, Math.round(base + (sun[c]! - base) * glow + grain)));
      }
    }
  }
  return { rgb, grainy: rand };
}

/**
 * A 480×320 abstract "photo": sky-to-ground gradient, a soft sun disc, and
 * film grain. Enough to read as photography at card size.
 */
export function seedPhoto(name: string, w = 480, h = 320): Uint8Array {
  const { rgb } = scene(rng(name), w, h);
  // PNG scanlines: each row prefixed with a filter byte (0 = none).
  const raw = new Uint8Array((1 + w * 3) * h);
  for (let y = 0; y < h; y++) {
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const ihdr = concat([be32(w), be32(h), new Uint8Array([8, 2, 0, 0, 0])]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/* ------------------------------- clips --------------------------------- */
// Animated GIF writer, same no-dependency discipline as the PNG above. The
// LZW stream never compresses: it emits literal 8-bit codes and resets the
// dictionary (clear code) before the code width could grow — bigger bytes,
// dead-simple encoder, valid GIF.

const GIF_MIN_CODE = 7; // 128-entry color table → codes start at 8 bits
const GIF_CLEAR = 128;
const GIF_EOI = 129;

/** 5×5×5 RGB cube (125 colors) padded to a 128-entry table. */
const gifPalette = (): Uint8Array => {
  const table = new Uint8Array(128 * 3);
  let at = 0;
  for (let r = 0; r < 5; r++)
    for (let g = 0; g < 5; g++)
      for (let b = 0; b < 5; b++) {
        table[at++] = Math.round((r * 255) / 4);
        table[at++] = Math.round((g * 255) / 4);
        table[at++] = Math.round((b * 255) / 4);
      }
  return table; // entries 125..127 stay black, unused
};

const quantize = (rgb: Uint8Array): Uint8Array => {
  const level = (v: number) => Math.round((v / 255) * 4);
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < out.length; i++) {
    out[i] = level(rgb[i * 3]!) * 25 + level(rgb[i * 3 + 1]!) * 5 + level(rgb[i * 3 + 2]!);
  }
  return out;
};

/** Literal-only LZW: CLEAR, then 8-bit pixel codes with a CLEAR every 120
 *  literals (the dictionary would force 9-bit codes past ~126 entries). */
function lzwLiteral(indexes: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  const put = (code: number) => {
    acc |= code << bits;
    bits += GIF_MIN_CODE + 1;
    while (bits >= 8) {
      bytes.push(acc & 0xff);
      acc >>= 8;
      bits -= 8;
    }
  };
  put(GIF_CLEAR);
  for (let i = 0; i < indexes.length; i++) {
    if (i > 0 && i % 120 === 0) put(GIF_CLEAR);
    put(indexes[i]!);
  }
  put(GIF_EOI);
  if (bits > 0) bytes.push(acc & 0xff);
  return new Uint8Array(bytes);
}

const subBlocks = (data: Uint8Array): Uint8Array => {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += 255) {
    const block = data.subarray(at, Math.min(at + 255, data.length));
    parts.push(new Uint8Array([block.length]), block);
  }
  parts.push(new Uint8Array([0]));
  return concat(parts);
};

const u16 = (n: number): [number, number] => [n & 0xff, n >> 8];

/**
 * A looping 240×160 abstract "clip": the photo scenery drifting over ~10
 * frames. Same seeded determinism — one name, one clip, forever.
 */
export function seedClip(name: string, w = 240, h = 160, frames = 10): Uint8Array {
  const parts: Uint8Array[] = [
    new TextEncoder().encode('GIF89a'),
    new Uint8Array([...u16(w), ...u16(h), 0xf6, 0, 0]), // global 128-color table
    gifPalette(),
    // Netscape loop-forever extension.
    new Uint8Array([0x21, 0xff, 0x0b, ...new TextEncoder().encode('NETSCAPE2.0'), 3, 1, 0, 0, 0]),
  ];
  for (let f = 0; f < frames; f++) {
    // Re-seed per frame so the scenery params match; drift moves the sun.
    const indexes = quantize(scene(rng(name), w, h, f).rgb);
    parts.push(
      new Uint8Array([0x21, 0xf9, 4, 0, ...u16(12), 0, 0]), // ~120ms/frame
      new Uint8Array([0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0]),
      new Uint8Array([GIF_MIN_CODE]),
      subBlocks(lzwLiteral(indexes)),
    );
  }
  parts.push(new Uint8Array([0x3b]));
  return concat(parts);
}
