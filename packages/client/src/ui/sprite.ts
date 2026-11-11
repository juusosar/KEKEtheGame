// The game's own sprites as HTML elements, for menu screens (How to play). A sprite is a <span> showing
// one atlas frame as a CSS background, scaled with crisp pixels. No extra <canvas>: the page keeps the
// one Phaser canvas. A tint colours a greyscale sheet (the player body) the way Phaser's setTint does:
// the colour is multiplied in, and a mask of the same frame keeps the transparent pixels transparent.

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}
interface Atlas {
  frames: Record<string, AtlasFrame>;
  meta: { size: { w: number; h: number } };
}

const atlases = new Map<string, Promise<Atlas | null>>();

/** Loads `assets/<key>.json` once per page; null when it cannot be read. */
function loadAtlas(key: string): Promise<Atlas | null> {
  let atlas = atlases.get(key);
  if (atlas === undefined) {
    atlas = fetch(`assets/${key}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<Atlas>) : null))
      .catch(() => null);
    atlases.set(key, atlas);
  }
  return atlas;
}

export interface SpriteOptions {
  /** Pixel scale (default 2). */
  scale?: number;
  /** CSS colour multiplied into the frame (greyscale sheets). */
  tint?: string;
  /** Size of the frame before it loads, in sheet pixels (default 32 × 32), so the layout does not jump. */
  size?: { w: number; h: number };
  /** Extra class names. */
  className?: string;
}

/** A span showing frame `frame` of atlas `atlas` (a key in public/assets/manifest.json). */
export function sprite(atlas: string, frame: string, opts: SpriteOptions = {}): HTMLSpanElement {
  const scale = opts.scale ?? 2;
  const el = document.createElement('span');
  el.className = ['keke-sprite', opts.className ?? ''].join(' ').trim();
  el.setAttribute('aria-hidden', 'true');
  el.dataset['sprite'] = `${atlas}:${frame}`;
  const size = opts.size ?? { w: 32, h: 32 };
  el.style.width = `${size.w * scale}px`;
  el.style.height = `${size.h * scale}px`;
  void loadAtlas(atlas).then((data) => {
    const f = data?.frames[frame]?.frame;
    if (data === null || f === undefined) return;
    const url = `url("assets/${atlas}.png")`;
    const position = `${-f.x * scale}px ${-f.y * scale}px`;
    const sheet = `${data.meta.size.w * scale}px ${data.meta.size.h * scale}px`;
    el.style.width = `${f.w * scale}px`;
    el.style.height = `${f.h * scale}px`;
    el.style.backgroundImage = url;
    el.style.backgroundPosition = position;
    el.style.backgroundSize = sheet;
    if (opts.tint !== undefined) {
      el.style.backgroundColor = opts.tint;
      el.style.backgroundBlendMode = 'multiply';
      for (const prefix of ['', '-webkit-']) {
        el.style.setProperty(`${prefix}mask-image`, url);
        el.style.setProperty(`${prefix}mask-position`, position);
        el.style.setProperty(`${prefix}mask-size`, sheet);
        el.style.setProperty(`${prefix}mask-repeat`, 'no-repeat');
      }
    }
    el.dataset['loaded'] = 'true';
  });
  return el;
}

/** A player as drawn in a round: the tinted body with a hat on top. */
export function character(
  color: string,
  hat: string | null,
  frame = 'idle_down_0',
  scale = 2,
): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'keke-character';
  el.setAttribute('aria-hidden', 'true');
  el.append(sprite('body', frame, { scale, tint: color }));
  if (hat !== null) el.append(sprite(`hat_${hat}`, frame, { scale, className: 'hat' }));
  return el;
}
