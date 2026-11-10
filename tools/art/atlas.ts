// Packs frames into one texture and writes Phaser/TexturePacker JSON-hash atlas data.
import { Canvas } from './canvas';
import { encodePng } from './png';

export interface Frame {
  name: string;
  canvas: Canvas;
}

export interface AtlasFrameJson {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: number; h: number };
  sourceSize: { w: number; h: number };
}

export interface AtlasJson {
  frames: Record<string, AtlasFrameJson>;
  meta: {
    app: string;
    version: string;
    image: string;
    format: 'RGBA8888';
    size: { w: number; h: number };
    scale: '1';
  };
}

export interface PackedAtlas {
  key: string;
  png: Buffer;
  json: AtlasJson;
}

/** Transparent gap between frames so neighbours never bleed into each other. */
const PADDING = 2;

/**
 * Shelf-packs frames in the given order (left to right, then a new row) into a sheet
 * no wider than `maxWidth`. Deterministic: same frames in the same order → same layout.
 */
export function packAtlas(key: string, frames: readonly Frame[], maxWidth = 512): PackedAtlas {
  const names = new Set<string>();
  const placed: { frame: Frame; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const frame of frames) {
    if (names.has(frame.name)) throw new Error(`packAtlas(${key}): duplicate frame ${frame.name}`);
    names.add(frame.name);
    const { width: w, height: h } = frame.canvas;
    if (x > 0 && x + w > maxWidth) {
      x = 0;
      y += rowH + PADDING;
      rowH = 0;
    }
    placed.push({ frame, x, y });
    x += w + PADDING;
    rowH = Math.max(rowH, h);
    width = Math.max(width, x - PADDING);
  }
  const height = y + rowH;
  const sheet = new Canvas(width, height);
  const json: AtlasJson = {
    frames: {},
    meta: {
      app: 'tools/gen-placeholder-art.ts',
      version: '1',
      image: `${key}.png`,
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: '1',
    },
  };
  for (const { frame, x: fx, y: fy } of placed) {
    const { width: w, height: h } = frame.canvas;
    sheet.copyFrom(frame.canvas, fx, fy);
    json.frames[frame.name] = {
      frame: { x: fx, y: fy, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
    };
  }
  return { key, png: encodePng(width, height, sheet.data), json };
}
