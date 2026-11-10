// A tiny RGBA pixel canvas with the drawing primitives the placeholder art needs.
// Everything is integer-pixel and deterministic: no anti-aliasing, no randomness.

export type Rgba = readonly [number, number, number, number];

/** Parses `#rrggbb` into an RGBA tuple. */
export function hex(color: string, alpha = 255): Rgba {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m?.[1]) throw new Error(`hex: bad colour ${color}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, alpha];
}

/** §11: bold dark outline colour. */
export const OUTLINE = hex('#1a1a1a');
export const TRANSPARENT: Rgba = [0, 0, 0, 0];

// 3×5 bitmap font. '#' = ink.
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  ' ': ['...', '...', '...', '...', '...'],
};

const UNKNOWN_GLYPH: readonly string[] = ['##.', '..#', '.#.', '...', '.#.'];

export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** Pixel width of `text` at `scale`, with one pixel (×scale) between glyphs. */
export function textWidth(text: string, scale = 1): number {
  return text.length === 0 ? 0 : (text.length * (GLYPH_W + 1) - 1) * scale;
}

export class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[(y * this.width + x) * 4 + 3] ?? 0;
  }

  /** Paints one pixel, alpha-blending (source-over) when the colour is translucent. */
  set(x: number, y: number, c: Rgba): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return this;
    const i = (y * this.width + x) * 4;
    const sa = c[3] / 255;
    if (sa >= 1) {
      this.data.set(c, i);
      return this;
    }
    if (sa <= 0) return this;
    const da = (this.data[i + 3] ?? 0) / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      const d = this.data[i + k] ?? 0;
      this.data[i + k] = Math.round(((c[k] ?? 0) * sa + d * da * (1 - sa)) / oa);
    }
    this.data[i + 3] = Math.round(oa * 255);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Rgba): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    return this;
  }

  /** Filled axis-aligned ellipse centred on (cx, cy) in pixel-centre coordinates. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgba): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Bresenham line, `thickness` pixels square brush. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgba, thickness = 1): this {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const off = Math.floor((thickness - 1) / 2);
    for (;;) {
      this.rect(x0 - off, y0 - off, thickness, thickness, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  text(text: string, x: number, y: number, c: Rgba, scale = 1): this {
    let cx = x;
    for (const ch of text.toUpperCase()) {
      const glyph = GLYPHS[ch] ?? UNKNOWN_GLYPH;
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (row[gx] === '#') this.rect(cx + gx * scale, y + gy * scale, scale, scale, c);
        }
      });
      cx += (GLYPH_W + 1) * scale;
    }
    return this;
  }

  /** Draws `text` horizontally centred on `cx` with its top at `y`. */
  textCentered(text: string, cx: number, y: number, c: Rgba, scale = 1): this {
    return this.text(text, Math.round(cx - textWidth(text, scale) / 2), y, c, scale);
  }

  /** Adds a 1 px outline around every opaque region (4-neighbourhood). */
  outline(c: Rgba = OUTLINE): this {
    const edge: [number, number][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.alphaAt(x, y) !== 0) continue;
        if (
          this.alphaAt(x - 1, y) > 0 ||
          this.alphaAt(x + 1, y) > 0 ||
          this.alphaAt(x, y - 1) > 0 ||
          this.alphaAt(x, y + 1) > 0
        ) {
          edge.push([x, y]);
        }
      }
    }
    for (const [x, y] of edge) this.set(x, y, c);
    return this;
  }

  /** Copies `src` onto this canvas at (dx, dy), alpha-blending. */
  blit(src: Canvas, dx: number, dy: number): this {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3] ?? 0;
        if (a === 0) continue;
        this.set(dx + x, dy + y, [src.data[i] ?? 0, src.data[i + 1] ?? 0, src.data[i + 2] ?? 0, a]);
      }
    }
    return this;
  }

  /** Copies raw pixels (no blending) into this canvas at (dx, dy). */
  copyFrom(src: Canvas, dx: number, dy: number): this {
    for (let y = 0; y < src.height; y++) {
      const from = y * src.width * 4;
      this.data.set(src.data.subarray(from, from + src.width * 4), ((dy + y) * this.width + dx) * 4);
    }
    return this;
  }
}
