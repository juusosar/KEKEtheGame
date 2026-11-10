// Builds every placeholder art file in memory. Pure and deterministic: the same code always
// produces byte-identical output, so the committed assets can be checked against it.
import { packAtlas, type Frame } from './atlas';
import { CHARACTER_ANIMS, DIRECTIONS, bodyFrames, hatSheets, npcSheets } from './characters';
import { forkliftFrames, fxFrames, itemFrames, orderBoxFrames, vanFrames, weaponFrames } from './objects';
import { ART_THEMES, type ArtTheme } from './theme';
import { TILE, buildTileset } from './tiles';

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

export interface AssetManifest {
  atlases: { key: string; texture: string; atlas: string }[];
  animations: AnimationDef[];
  tilesets: { key: string; image: string; tileWidth: number; tileHeight: number }[];
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

function sheets(theme: ArtTheme): Sheet[] {
  return [
    { key: 'body', frames: bodyFrames(), animations: characterAnimations('body') },
    ...hatSheets().map((s) => ({ ...s, animations: characterAnimations(s.key) })),
    ...npcSheets().map((s) => ({ ...s, animations: characterAnimations(s.key) })),
    { key: 'weapons', frames: weaponFrames(), animations: [] },
    { key: 'items', frames: itemFrames(), animations: [] },
    { key: 'order_box', frames: orderBoxFrames(theme), animations: [] },
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
    { key: 'van', frames: vanFrames(theme), animations: [], maxWidth: 560 },
    { key: 'fx', frames: fxFrames(), animations: [] },
  ];
}

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

/** Every generated file, keyed by path relative to the repo root, in a stable order. */
export function generateAll(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const manifest: AssetManifest = { atlases: [], animations: [], tilesets: [] };
  // v1 art is shared by every map theme except the tileset and theme-coloured props,
  // which come from the first (default) theme. Phase 2 adds per-theme variants.
  const [defaultTheme] = ART_THEMES;
  if (!defaultTheme) throw new Error('No art theme configured');
  for (const sheet of sheets(defaultTheme)) {
    const atlas = packAtlas(sheet.key, sheet.frames, sheet.maxWidth);
    files.set(`${ASSETS_DIR}/${sheet.key}.png`, atlas.png);
    files.set(`${ASSETS_DIR}/${sheet.key}.json`, json(atlas.json));
    manifest.atlases.push({ key: sheet.key, texture: `${sheet.key}.png`, atlas: `${sheet.key}.json` });
    manifest.animations.push(...sheet.animations);
  }
  for (const theme of ART_THEMES) {
    const key = theme.tileset.replace(/\.png$/, '');
    const tileset = buildTileset(theme, key, `../${ASSETS_DIR}/${theme.tileset}`);
    files.set(`${ASSETS_DIR}/${theme.tileset}`, tileset.png);
    files.set(`${MAPS_DIR}/${key}.tsj`, json(tileset.tsj));
    manifest.tilesets.push({ key, image: theme.tileset, tileWidth: TILE, tileHeight: TILE });
  }
  files.set(`${ASSETS_DIR}/manifest.json`, json(manifest));
  return files;
}
