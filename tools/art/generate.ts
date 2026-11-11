// Builds every placeholder art file in memory. Pure and deterministic: the same code always
// produces byte-identical output, so the committed assets can be checked against it.
import { packAtlas, type Frame } from './atlas';
import { CHARACTER_ANIMS, DIRECTIONS, bodyFrames, hatSheets, npcSheets } from './characters';
import {
  cartFrames,
  forkliftFrames,
  fxFrames,
  gateFrames,
  itemFrames,
  orderBoxFrames,
  vanFrames,
  weaponFrames,
} from './objects';
import { ART_THEMES, type ArtTheme } from './theme';
import { TILE, buildTileset } from './tiles';
import { tilesetFor } from './tilesets';

/** Where the client serves assets from, relative to the repo root (§15.2). */
export const ASSETS_DIR = 'packages/client/public/assets';
/** Where Tiled tilesets live, relative to the repo root (§15.2). */
export const MAPS_DIR = 'maps';

export interface AnimationDef {
  /** `<sheet>/<anim>_<dir>` (§11.1), e.g. `body/walk_down`. */
  key: string;
  atlas: string;
  frames: string[];
  frameRate: number;
  /** -1 loops forever, 0 plays once. */
  repeat: number;
}

/** Per map theme: its tileset key and which atlas holds each theme-coloured sheet. */
export interface ThemeAssets {
  tileset: string;
  /** Sheet name (`van`, `order_box`, `cart`, `gate`) → atlas key. */
  atlases: Record<string, string>;
}

export interface AssetManifest {
  atlases: { key: string; texture: string; atlas: string }[];
  animations: AnimationDef[];
  tilesets: { key: string; image: string; tileWidth: number; tileHeight: number }[];
  /** Theme id → its assets. The default theme's sheets keep the bare names (`van`, ...). */
  themes: Record<string, ThemeAssets>;
}

/** Placeholder playback speeds, frames per second. Data, not code: real art can retune them. */
const CHARACTER_TIMING: Record<string, { frameRate: number; repeat: number }> = {
  idle: { frameRate: 3, repeat: -1 },
  walk: { frameRate: 8, repeat: -1 },
  attack: { frameRate: 12, repeat: 0 },
  hit: { frameRate: 1, repeat: 0 },
  ko: { frameRate: 1, repeat: 0 },
};

function characterAnimations(atlas: string): AnimationDef[] {
  const out: AnimationDef[] = [];
  for (const { anim, frames } of CHARACTER_ANIMS) {
    const timing = CHARACTER_TIMING[anim] ?? { frameRate: 8, repeat: -1 };
    for (const dir of DIRECTIONS) {
      out.push({
        key: `${atlas}/${anim}_${dir}`,
        atlas,
        frames: Array.from({ length: frames }, (_, i) => `${anim}_${dir}_${i}`),
        ...timing,
      });
    }
  }
  return out;
}

interface Sheet {
  key: string;
  frames: Frame[];
  animations: AnimationDef[];
  maxWidth?: number;
}

/** Sheets every theme shares. */
function commonSheets(): Sheet[] {
  return [
    { key: 'body', frames: bodyFrames(), animations: characterAnimations('body') },
    ...hatSheets().map((s) => ({ ...s, animations: characterAnimations(s.key) })),
    ...npcSheets().map((s) => ({ ...s, animations: characterAnimations(s.key) })),
    { key: 'weapons', frames: weaponFrames(), animations: [] },
    { key: 'items', frames: itemFrames(), animations: [] },
    {
      key: 'forklift',
      frames: forkliftFrames(),
      animations: DIRECTIONS.map((dir) => ({
        key: `forklift/drive_${dir}`,
        atlas: 'forklift',
        frames: [`drive_${dir}_0`, `drive_${dir}_1`],
        frameRate: 4,
        repeat: -1,
      })),
    },
    { key: 'fx', frames: fxFrames(), animations: [] },
  ];
}

/** Sheets painted in a theme's colours / logo letter; `key` is the sheet name before suffixing. */
function themedSheets(theme: ArtTheme): Sheet[] {
  return [
    { key: 'order_box', frames: orderBoxFrames(theme), animations: [] },
    { key: 'van', frames: vanFrames(theme), animations: [], maxWidth: 560 },
    { key: 'cart', frames: cartFrames(theme), animations: [] },
    { key: 'gate', frames: gateFrames(theme), animations: [] },
  ];
}

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

/** Every generated file, keyed by path relative to the repo root, in a stable order. */
export function generateAll(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const manifest: AssetManifest = { atlases: [], animations: [], tilesets: [], themes: {} };
  const addSheet = (sheet: Sheet, key: string): void => {
    const atlas = packAtlas(key, sheet.frames, sheet.maxWidth);
    files.set(`${ASSETS_DIR}/${key}.png`, atlas.png);
    files.set(`${ASSETS_DIR}/${key}.json`, json(atlas.json));
    manifest.atlases.push({ key, texture: `${key}.png`, atlas: `${key}.json` });
    manifest.animations.push(...sheet.animations);
  };
  for (const sheet of commonSheets()) addSheet(sheet, sheet.key);
  // The default (first) theme keeps the bare sheet names the client has always loaded
  // (`van`, `order_box`); every other theme's copies are suffixed with its id (`van_<id>`).
  ART_THEMES.forEach((theme, i) => {
    const atlases: Record<string, string> = {};
    for (const sheet of themedSheets(theme)) {
      const key = i === 0 ? sheet.key : `${sheet.key}_${theme.id}`;
      addSheet(sheet, key);
      atlases[sheet.key] = key;
    }
    const tilesetKey = theme.tileset.replace(/\.png$/, '');
    const { tiles, paint } = tilesetFor(theme.id);
    const tileset = buildTileset(theme, tilesetKey, `../${ASSETS_DIR}/${theme.tileset}`, tiles, paint);
    files.set(`${ASSETS_DIR}/${theme.tileset}`, tileset.png);
    files.set(`${MAPS_DIR}/${tilesetKey}.tsj`, json(tileset.tsj));
    manifest.tilesets.push({ key: tilesetKey, image: theme.tileset, tileWidth: TILE, tileHeight: TILE });
    manifest.themes[theme.id] = { tileset: tilesetKey, atlases };
  });
  files.set(`${ASSETS_DIR}/manifest.json`, json(manifest));
  return files;
}
