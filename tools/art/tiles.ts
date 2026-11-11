// Map tileset (§11.1 "Tiles 32 × 32, tileset per map"): the theme's tileset PNG plus a Tiled
// tileset (.tsj) whose tiles carry a `name` property, so map tools can look tiles up by name.
import { Canvas, hex, type Rgba } from './canvas';
import type { ArtTheme } from './theme';
import { encodePng } from './png';

export const TILE = 32;
export const TILESET_COLUMNS = 8;

/** One tile in a tileset: `solid` tiles go on the `walls` layer, `above` tiles on the `above` layer. */
export interface TileDef {
  readonly name: string;
  readonly solid: boolean;
  readonly above?: boolean;
}

/** Paints one named tile of a tileset into a 32 × 32 canvas. */
export type TilePainter = (c: Canvas, name: string, theme: ArtTheme) => void;

/**
 * The first store's tiles (kespro), in tileset order (index = local tile id; Tiled gid = firstgid + index).
 * `solid` tiles are the ones meant for the `walls` layer; `above` tiles for the `above` layer.
 */
export const TILES = [
  { name: 'floor', solid: false },
  { name: 'floor_alt', solid: false },
  { name: 'floor_cold', solid: false },
  { name: 'floor_staff', solid: false },
  { name: 'floor_office', solid: false },
  { name: 'dock', solid: false },
  { name: 'asphalt', solid: false },
  { name: 'sidewalk', solid: false },
  { name: 'road', solid: false },
  { name: 'road_line', solid: false },
  { name: 'parking_line', solid: false },
  { name: 'grass', solid: false },
  { name: 'entrance_mat', solid: false },
  { name: 'curtain', solid: false, above: true },
  { name: 'door', solid: false },
  { name: 'staff_door', solid: false },
  { name: 'wall', solid: true },
  { name: 'wall_window', solid: true },
  { name: 'rack', solid: true },
  { name: 'rack_top', solid: false, above: true },
  { name: 'pallet_stack', solid: true },
  { name: 'freezer', solid: true },
  { name: 'fridge', solid: true },
  { name: 'counter', solid: true },
  { name: 'checkout', solid: true },
  { name: 'trolley', solid: true },
  { name: 'car', solid: true },
  { name: 'crate', solid: true },
  { name: 'sign', solid: false, above: true },
  { name: 'hazard', solid: false },
  { name: 'office_desk', solid: true },
  { name: 'tree', solid: true },
] as const satisfies readonly TileDef[];

export type TileName = (typeof TILES)[number]['name'];

/** Local tile index by name. */
export function tileIndex(name: TileName): number {
  return TILES.findIndex((t) => t.name === name);
}

const INK = hex('#1a1a1a');
const WHITE = hex('#ffffff');

function speckle(c: Canvas, col: Rgba, step: number): void {
  // Fixed pattern (no RNG needed): a sparse diagonal lattice of specks.
  for (let y = 1; y < TILE; y += step) for (let x = (y * 3) % step; x < TILE; x += step) c.set(x, y, col);
}

/** Paints a tile of the first store's tileset ({@link TILES}). */
export function drawTile(c: Canvas, name: TileName, theme: ArtTheme): void {
  const concrete = hex(theme.concrete);
  const primary = hex(theme.primary);
  const dark = hex(theme.dark);
  const box = (col: Rgba, x: number, y: number, w: number, h: number): void => {
    c.rect(x, y, w, h, col)
      .rect(x, y, w, 1, INK)
      .rect(x, y + h - 1, w, 1, INK)
      .rect(x, y, 1, h, INK)
      .rect(x + w - 1, y, 1, h, INK);
  };
  switch (name) {
    case 'floor':
      c.rect(0, 0, TILE, TILE, concrete);
      speckle(c, hex('#a9a59f'), 7);
      c.rect(0, 0, TILE, 1, hex('#aaa6a0')).rect(0, 0, 1, TILE, hex('#aaa6a0'));
      break;
    case 'floor_alt':
      c.rect(0, 0, TILE, TILE, hex('#b0aca6'));
      speckle(c, hex('#9e9a94'), 6);
      c.line(4, 6, 12, 14, hex('#8f8b85')).line(12, 14, 14, 24, hex('#8f8b85'));
      break;
    case 'floor_cold':
      c.rect(0, 0, TILE, TILE, hex('#d6ecf5'));
      c.rect(0, 15, TILE, 1, hex('#b5d3e0')).rect(15, 0, 1, TILE, hex('#b5d3e0'));
      c.set(6, 6, WHITE).set(22, 22, WHITE).set(7, 6, WHITE).set(23, 22, WHITE);
      break;
    case 'floor_staff':
      c.rect(0, 0, TILE, TILE, hex('#d9cba8'));
      speckle(c, hex('#c6b892'), 8);
      break;
    case 'floor_office':
      c.rect(0, 0, TILE, TILE, hex('#a0703c'));
      for (let y = 0; y < TILE; y += 8) c.rect(0, y, TILE, 1, hex('#80562a'));
      c.rect(10, 0, 1, 8, hex('#80562a'))
        .rect(24, 8, 1, 8, hex('#80562a'))
        .rect(6, 16, 1, 8, hex('#80562a'))
        .rect(20, 24, 1, 8, hex('#80562a'));
      break;
    case 'dock':
      c.rect(0, 0, TILE, TILE, hex('#9c9890'));
      speckle(c, hex('#8a867e'), 6);
      c.rect(0, 28, TILE, 4, hex('#f5c518'));
      for (let x = 0; x < TILE; x += 8) c.rect(x, 28, 4, 4, INK);
      break;
    case 'asphalt':
      c.rect(0, 0, TILE, TILE, hex('#4a4a4f'));
      speckle(c, hex('#5c5c62'), 5);
      break;
    case 'sidewalk':
      c.rect(0, 0, TILE, TILE, hex('#c9c6bf'));
      c.rect(0, 0, TILE, 1, hex('#a9a69f'))
        .rect(0, 0, 1, TILE, hex('#a9a69f'))
        .rect(0, 16, TILE, 1, hex('#a9a69f'));
      break;
    case 'road':
      c.rect(0, 0, TILE, TILE, hex('#3a3a3f'));
      speckle(c, hex('#48484e'), 5);
      break;
    case 'road_line':
      c.rect(0, 0, TILE, TILE, hex('#3a3a3f'));
      c.rect(0, 14, 20, 4, WHITE);
      break;
    case 'parking_line':
      c.rect(0, 0, TILE, TILE, hex('#4a4a4f'));
      c.rect(0, 0, 3, TILE, WHITE);
      break;
    case 'grass':
      c.rect(0, 0, TILE, TILE, hex('#5fa04e'));
      speckle(c, hex('#4c8a3d'), 4);
      break;
    case 'entrance_mat':
      c.rect(0, 0, TILE, TILE, hex('#3b3b3b'));
      for (let y = 3; y < TILE; y += 4) c.rect(2, y, TILE - 4, 1, hex('#555555'));
      break;
    case 'curtain':
      for (let x = 1; x < TILE; x += 5) c.rect(x, 0, 3, TILE, hex('#dff3ff', 150));
      for (let x = 1; x < TILE; x += 5) c.rect(x, 0, 1, TILE, hex('#ffffff', 190));
      break;
    case 'door':
      c.rect(0, 0, TILE, TILE, concrete);
      c.rect(2, 12, 28, 8, hex('#9fd3f0'));
      c.rect(15, 12, 2, 8, INK);
      break;
    case 'staff_door':
      c.rect(0, 0, TILE, TILE, hex('#d9cba8'));
      c.rect(2, 12, 28, 8, hex('#c0392b'));
      c.textCentered('STAFF', 16, 14, WHITE);
      break;
    case 'wall':
      c.rect(0, 0, TILE, TILE, dark);
      c.rect(0, 0, TILE, 4, hex('#444444'));
      c.rect(0, 28, TILE, 4, hex('#1f1f1f'));
      break;
    case 'wall_window':
      c.rect(0, 0, TILE, TILE, dark);
      c.rect(4, 8, 24, 14, hex('#9fd3f0'));
      c.line(8, 18, 14, 12, WHITE);
      break;
    case 'rack':
      c.rect(0, 0, TILE, TILE, hex('#2b4a7a'));
      c.rect(0, 0, 3, TILE, primary).rect(29, 0, 3, TILE, primary);
      c.rect(0, 15, TILE, 2, primary);
      box(hex('#c69c6d'), 4, 3, 11, 11);
      box(hex('#d8b483'), 16, 5, 12, 9);
      box(hex('#c69c6d'), 5, 18, 22, 11);
      break;
    case 'rack_top':
      c.rect(0, 0, TILE, 12, hex('#2b4a7a', 220));
      c.rect(0, 10, TILE, 2, primary);
      box(hex('#c69c6d'), 3, 1, 12, 9);
      box(hex('#d8b483'), 17, 2, 12, 8);
      break;
    case 'pallet_stack':
      c.rect(1, 25, 30, 6, hex('#b08a5a'));
      box(hex('#e74c3c'), 2, 2, 14, 12);
      box(hex('#3498db'), 16, 2, 14, 12);
      box(hex('#f1c40f'), 2, 13, 28, 12);
      break;
    case 'freezer':
      c.rect(0, 0, TILE, TILE, hex('#e8f4f8'));
      c.rect(2, 2, 28, 28, hex('#9fd3f0'));
      c.rect(2, 15, 28, 2, hex('#e8f4f8'));
      c.line(5, 12, 11, 6, WHITE).line(5, 27, 11, 21, WHITE);
      break;
    case 'fridge':
      c.rect(0, 0, TILE, TILE, hex('#dfe6e9'));
      c.rect(2, 2, 28, 28, hex('#74b9ff'));
      for (let y = 9; y < 30; y += 7) c.rect(2, y, 28, 1, hex('#dfe6e9'));
      break;
    case 'counter':
      c.rect(0, 0, TILE, TILE, hex('#ecf0f1'));
      c.rect(0, 0, TILE, 10, hex('#b2bec3'));
      c.rect(4, 2, 8, 6, hex('#e17055')).rect(18, 2, 9, 6, hex('#fab1a0'));
      c.rect(0, 10, TILE, 2, INK);
      break;
    case 'checkout':
      c.rect(0, 0, TILE, TILE, concrete);
      c.rect(4, 0, 12, TILE, hex('#636e72'));
      c.rect(6, 4, 8, 22, hex('#2d3436'));
      c.rect(18, 8, 10, 8, dark).rect(20, 10, 6, 3, hex('#55efc4'));
      break;
    case 'trolley':
      c.rect(0, 0, TILE, TILE, concrete);
      for (let x = 2; x < 30; x += 6) box(hex('#b2bec3'), x, 4, 8, 22);
      break;
    case 'car':
      c.rect(0, 0, TILE, TILE, hex('#4a4a4f'));
      c.rect(3, 2, 26, 28, hex('#2980b9'));
      c.rect(6, 6, 20, 6, hex('#2c3e50')).rect(6, 20, 20, 5, hex('#2c3e50'));
      break;
    case 'crate':
      c.rect(0, 0, TILE, TILE, concrete);
      box(hex('#a0703c'), 3, 3, 26, 26);
      c.line(4, 4, 27, 27, hex('#80562a')).line(27, 4, 4, 27, hex('#80562a'));
      break;
    case 'sign':
      c.rect(2, 4, 28, 16, primary);
      c.rect(2, 4, 28, 1, INK).rect(2, 19, 28, 1, INK);
      c.textCentered(theme.logoLetter, 16, 7, WHITE, 2);
      break;
    case 'hazard':
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) c.set(x, y, (x + y) % 16 < 8 ? hex('#f5c518') : INK);
      break;
    case 'office_desk':
      c.rect(0, 0, TILE, TILE, hex('#a0703c'));
      box(hex('#dcdde1'), 2, 6, 28, 18);
      c.rect(8, 9, 10, 7, dark).rect(10, 11, 6, 3, hex('#74b9ff'));
      break;
    case 'tree':
      c.rect(0, 0, TILE, TILE, hex('#5fa04e'));
      c.ellipse(16, 15, 13, 12, hex('#2e7d32'));
      c.ellipse(12, 11, 6, 5, hex('#43a047'));
      break;
  }
}

export interface TilesetOutput {
  png: Buffer;
  /** Tiled tileset JSON (.tsj). */
  tsj: Record<string, unknown>;
}

/**
 * Builds a tileset image from `tiles` (default: the first store's), painted by `paint`;
 * `imagePath` is how the .tsj refers to the PNG.
 */
export function buildTileset(
  theme: ArtTheme,
  name: string,
  imagePath: string,
  tiles: readonly TileDef[] = TILES,
  paint: TilePainter = drawTile as TilePainter,
): TilesetOutput {
  const rows = Math.ceil(tiles.length / TILESET_COLUMNS);
  const width = TILESET_COLUMNS * TILE;
  const height = rows * TILE;
  const sheet = new Canvas(width, height);
  tiles.forEach((t, i) => {
    const c = new Canvas(TILE, TILE);
    paint(c, t.name, theme);
    sheet.copyFrom(c, (i % TILESET_COLUMNS) * TILE, Math.floor(i / TILESET_COLUMNS) * TILE);
  });
  const tsj = {
    type: 'tileset',
    version: '1.10',
    name,
    image: imagePath,
    imagewidth: width,
    imageheight: height,
    tilewidth: TILE,
    tileheight: TILE,
    tilecount: tiles.length,
    columns: TILESET_COLUMNS,
    margin: 0,
    spacing: 0,
    tiles: tiles.map((t, id) => ({
      id,
      properties: [
        { name: 'name', type: 'string', value: t.name },
        { name: 'solid', type: 'bool', value: t.solid },
        { name: 'above', type: 'bool', value: t.above === true },
      ],
    })),
  };
  return { png: encodePng(width, height, sheet.data), tsj };
}
