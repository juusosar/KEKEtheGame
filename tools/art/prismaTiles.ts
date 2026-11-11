// Supermarket tileset for the second map (phase 2 P1-2, §9.2): light floor, low shelves, fridges,
// chest freezers, bakery with oven, deli counter, bottle machine, self-checkout, sliding entrance
// door, cart corral rails, parking lot, road and office. Colours come from the theme (prisma.ts);
// tiles the stores share (asphalt, road, grass, ...) reuse the first store's painter unchanged.
import type { Canvas } from './canvas';
import { hex, shade, type Rgba } from './canvas';
import type { ArtTheme } from './theme';
import { TILE, drawTile, type TileDef, type TileName } from './tiles';

/**
 * Tile names in tileset order (index = local tile id; Tiled gid = firstgid + index). Append new
 * tiles at the end so the map's tile ids stay stable.
 */
export const PRISMA_TILES = [
  // Floors (walkable)
  { name: 'floor', solid: false },
  { name: 'floor_alt', solid: false },
  { name: 'floor_cold', solid: false },
  { name: 'floor_bakery', solid: false },
  { name: 'floor_staff', solid: false },
  { name: 'floor_office', solid: false },
  { name: 'oven_heat', solid: false },
  { name: 'entrance_mat', solid: false },
  // Outside (walkable)
  { name: 'asphalt', solid: false },
  { name: 'parking_line', solid: false },
  { name: 'sidewalk', solid: false },
  { name: 'road', solid: false },
  { name: 'road_line', solid: false },
  { name: 'crosswalk', solid: false },
  { name: 'grass', solid: false },
  { name: 'corral_floor', solid: false },
  // Doors and markings (walkable)
  { name: 'door', solid: false },
  { name: 'staff_door', solid: false },
  { name: 'sliding_door', solid: false },
  { name: 'gate_lane', solid: false },
  { name: 'hazard', solid: false },
  { name: 'sign', solid: false, above: true },
  // Walls and fixtures (solid)
  { name: 'wall', solid: true },
  { name: 'wall_window', solid: true },
  { name: 'shelf_low', solid: true },
  { name: 'shelf_end', solid: true },
  { name: 'fridge', solid: true },
  { name: 'freezer_chest', solid: true },
  { name: 'produce_stand', solid: true },
  { name: 'candy_bins', solid: true },
  { name: 'bakery_counter', solid: true },
  { name: 'oven', solid: true },
  { name: 'deli_counter', solid: true },
  { name: 'bottle_machine', solid: true },
  { name: 'checkout_kiosk', solid: true },
  { name: 'corral_rail', solid: true },
  { name: 'rack', solid: true },
  { name: 'pallet_stack', solid: true },
  { name: 'office_desk', solid: true },
  { name: 'car', solid: true },
  { name: 'tree', solid: true },
] as const satisfies readonly TileDef[];

export type PrismaTileName = (typeof PRISMA_TILES)[number]['name'];

/** Local tile index by name. */
export function prismaTileIndex(name: PrismaTileName): number {
  return PRISMA_TILES.findIndex((t) => t.name === name);
}

/** Tiles drawn exactly like the first store's (no theme colours, or only the logo/primary). */
const SHARED: ReadonlySet<string> = new Set<TileName>([
  'floor_cold',
  'floor_staff',
  'floor_office',
  'entrance_mat',
  'asphalt',
  'parking_line',
  'sidewalk',
  'road',
  'road_line',
  'grass',
  'staff_door',
  'hazard',
  'sign',
  'rack',
  'pallet_stack',
  'car',
  'tree',
]);

const INK = hex('#1a1a1a');
const WHITE = hex('#ffffff');
const GLASS = hex('#9fd3f0');
const STEEL = hex('#9aa5ab');

/** Paints one tile of {@link PRISMA_TILES}. */
export function drawPrismaTile(c: Canvas, name: string, theme: ArtTheme): void {
  if (SHARED.has(name)) {
    drawTile(c, name as TileName, theme);
    return;
  }
  const floor = hex(theme.concrete);
  const grout = shade(floor, -0.1);
  const primary = hex(theme.primary);
  const deep = shade(primary, -0.45);
  const box = (col: Rgba, x: number, y: number, w: number, h: number): void => {
    c.rect(x, y, w, h, col)
      .rect(x, y, w, 1, INK)
      .rect(x, y + h - 1, w, 1, INK)
      .rect(x, y, 1, h, INK)
      .rect(x + w - 1, y, 1, h, INK);
  };
  const tiledFloor = (col: Rgba, line: Rgba): void => {
    c.rect(0, 0, TILE, TILE, col);
    c.rect(0, 0, TILE, 1, line)
      .rect(0, 0, 1, TILE, line)
      .rect(0, 16, TILE, 1, line)
      .rect(16, 0, 1, TILE, line);
  };
  switch (name as PrismaTileName) {
    case 'floor':
      tiledFloor(floor, grout);
      break;
    case 'floor_alt':
      tiledFloor(hex('#f4f1ea'), hex('#ddd8cc'));
      break;
    case 'floor_bakery':
      // Warm terracotta tiles in a checker.
      for (let y = 0; y < TILE; y += 8)
        for (let x = 0; x < TILE; x += 8)
          c.rect(x, y, 8, 8, (x + y) % 16 === 0 ? hex('#e8b07a') : hex('#d99a62'));
      break;
    case 'oven_heat':
      // Floor in front of the oven: hot glow with heat lines (the oven hazard sub-zone).
      c.rect(0, 0, TILE, TILE, hex('#e8b07a'));
      c.rect(0, 0, TILE, TILE, hex('#ff5a1f', 90));
      for (let x = 3; x < TILE; x += 9) {
        c.line(x, 28, x + 2, 22, hex('#fff1c2', 200)).line(x + 2, 22, x, 16, hex('#fff1c2', 200));
        c.line(x, 16, x + 2, 10, hex('#fff1c2', 200));
      }
      break;
    case 'crosswalk':
      c.rect(0, 0, TILE, TILE, hex('#3a3a3f'));
      for (let y = 2; y < TILE; y += 8) c.rect(2, y, 28, 4, WHITE);
      break;
    case 'corral_floor':
      c.rect(0, 0, TILE, TILE, hex('#4a4a4f'));
      for (let i = -TILE; i < TILE; i += 8) c.line(i, TILE - 1, i + TILE - 1, 0, primary, 2);
      break;
    case 'door':
      c.rect(0, 0, TILE, TILE, floor);
      c.rect(2, 12, 28, 8, GLASS);
      c.rect(15, 12, 2, 8, INK);
      break;
    case 'sliding_door':
      // Automatic entrance: two glass leaves pulled open to the sides, floor rail between them.
      c.rect(0, 0, TILE, TILE, hex('#3b3b3b'));
      c.rect(0, 14, TILE, 4, STEEL);
      c.rect(0, 11, 7, 10, GLASS).rect(25, 11, 7, 10, GLASS);
      c.rect(6, 11, 1, 10, INK).rect(25, 11, 1, 10, INK);
      c.rect(14, 4, 4, 2, primary).rect(14, 26, 4, 2, primary);
      break;
    case 'gate_lane':
      // Floor under a self-checkout gate: dashed lane edges; the gate itself is a sprite.
      c.rect(0, 0, TILE, TILE, floor);
      for (let y = 0; y < TILE; y += 8) c.rect(1, y, 2, 5, primary).rect(29, y, 2, 5, primary);
      break;
    case 'wall':
      // White store wall with a band in the theme colour.
      c.rect(0, 0, TILE, TILE, hex('#f2f2ee'));
      c.rect(0, 0, TILE, 3, hex('#d4d4cf'));
      c.rect(0, 12, TILE, 6, primary);
      c.rect(0, 29, TILE, 3, hex('#bdbdb7'));
      break;
    case 'wall_window':
      c.rect(0, 0, TILE, TILE, hex('#f2f2ee'));
      c.rect(2, 4, 28, 22, GLASS);
      c.line(6, 20, 14, 10, WHITE).line(12, 22, 20, 12, WHITE);
      c.rect(0, 28, TILE, 4, primary);
      break;
    case 'shelf_low':
      // Low gondola seen from above: a centre spine with goods on both faces (no `above` overlay).
      c.rect(0, 0, TILE, TILE, hex('#dfe4e1'));
      c.rect(0, 15, TILE, 2, STEEL);
      box(hex('#e74c3c'), 2, 3, 8, 10);
      box(hex('#f1c40f'), 11, 4, 9, 9);
      box(hex('#3498db'), 21, 3, 9, 10);
      box(hex('#9b59b6'), 2, 19, 10, 10);
      box(hex('#2ecc71'), 13, 19, 7, 10);
      box(hex('#e67e22'), 21, 19, 9, 10);
      break;
    case 'shelf_end':
      // End cap of a gondola run: price board in the theme colour.
      c.rect(0, 0, TILE, TILE, hex('#dfe4e1'));
      c.rect(2, 2, 28, 12, primary);
      c.rect(2, 2, 28, 1, INK).rect(2, 13, 28, 1, INK);
      c.textCentered('%', 16, 5, WHITE);
      box(hex('#f1c40f'), 4, 17, 11, 12);
      box(hex('#e74c3c'), 17, 17, 11, 12);
      break;
    case 'fridge':
      // Upright fridge wall with glass doors.
      c.rect(0, 0, TILE, TILE, hex('#dfe6e9'));
      c.rect(2, 2, 13, 28, GLASS).rect(17, 2, 13, 28, GLASS);
      for (let y = 8; y < 30; y += 7) c.rect(2, y, 28, 1, hex('#dfe6e9'));
      c.rect(13, 12, 1, 8, STEEL).rect(18, 12, 1, 8, STEEL);
      break;
    case 'freezer_chest':
      // Open chest freezer seen from above: white rim, frosty inside, packs in the tub.
      c.rect(0, 0, TILE, TILE, hex('#f5f8fa'));
      c.rect(3, 3, 26, 26, hex('#c9e8f6'));
      box(hex('#2a5db0'), 5, 6, 10, 8);
      box(hex('#e9e2c8'), 17, 5, 10, 9);
      box(hex('#e8505b'), 6, 17, 9, 9);
      box(hex('#7ec8e3'), 17, 18, 10, 8);
      c.set(10, 25, WHITE).set(24, 15, WHITE);
      break;
    case 'produce_stand':
      // Slanted crates of fruit and veg.
      c.rect(0, 0, TILE, TILE, hex('#8a6a43'));
      for (const [x, y, col] of [
        [2, 2, '#e74c3c'],
        [17, 2, '#f39c12'],
        [2, 17, '#7cb342'],
        [17, 17, '#f4d03f'],
      ] as const) {
        box(hex('#b08a5a'), x, y, 13, 13);
        for (let yy = y + 3; yy < y + 12; yy += 4)
          for (let xx = x + 3; xx < x + 12; xx += 4) c.ellipse(xx, yy, 1.5, 1.5, hex(col));
      }
      break;
    case 'candy_bins':
      // Pick-and-mix bins with clear lids.
      c.rect(0, 0, TILE, TILE, hex('#dfe4e1'));
      ['#ff6b9d', '#ffd166', '#06d6a0', '#118ab2'].forEach((col, i) => {
        const x = 1 + (i % 2) * 15;
        const y = 1 + Math.floor(i / 2) * 15;
        box(WHITE, x, y, 15, 15);
        for (let yy = y + 3; yy < y + 13; yy += 3)
          for (let xx = x + 3 + (yy % 2); xx < x + 13; xx += 3) c.set(xx, yy, hex(col));
      });
      break;
    case 'bakery_counter':
      c.rect(0, 0, TILE, TILE, hex('#c49a6c'));
      c.rect(0, 0, TILE, 12, hex('#e9dcc9'));
      c.ellipse(7, 6, 5, 3, hex('#d9a35b')).ellipse(18, 6, 4, 3, hex('#c98b3c'));
      c.line(23, 4, 30, 8, hex('#e0b070'), 2);
      c.rect(0, 12, TILE, 2, INK);
      for (let x = 4; x < TILE; x += 8) c.rect(x, 18, 4, 10, hex('#a87e50'));
      break;
    case 'oven':
      // Deck oven: steel front, glowing window, control dials.
      c.rect(0, 0, TILE, TILE, hex('#5f6b70'));
      c.rect(1, 1, 30, 3, hex('#7f8c8d'));
      c.rect(4, 8, 24, 13, hex('#2d1b0e'));
      c.rect(6, 10, 20, 9, hex('#ff7a1a'));
      c.rect(6, 15, 20, 4, hex('#ffb347'));
      c.ellipse(8, 26, 2, 2, INK).ellipse(16, 26, 2, 2, INK).ellipse(24, 26, 2, 2, hex('#e74c3c'));
      break;
    case 'deli_counter':
      // Service counter with a curved glass front over the trays.
      c.rect(0, 0, TILE, TILE, hex('#ecf0f1'));
      c.rect(0, 0, TILE, 14, hex('#cde7f2'));
      c.rect(3, 4, 8, 7, hex('#e17055')).rect(13, 4, 7, 7, hex('#fab1a0')).rect(22, 4, 7, 7, hex('#f6e27a'));
      c.rect(0, 0, TILE, 1, WHITE);
      c.rect(0, 14, TILE, 2, INK);
      c.rect(0, 16, TILE, 4, primary);
      break;
    case 'bottle_machine':
      // Reverse vending machine: intake hole, screen, receipt slot.
      c.rect(0, 0, TILE, TILE, hex('#d5dbdb'));
      box(hex('#ecf0f1'), 2, 2, 28, 28);
      c.ellipse(11, 15, 5, 5, INK);
      c.ellipse(11, 15, 3, 3, hex('#3b3b3b'));
      c.rect(19, 6, 8, 6, hex('#2d3436')).rect(20, 7, 6, 3, hex('#55efc4'));
      c.rect(20, 22, 7, 2, INK);
      c.rect(2, 2, 28, 2, primary);
      break;
    case 'checkout_kiosk':
      // Self-checkout: scanner glass, touch screen, bagging shelf.
      c.rect(0, 0, TILE, TILE, floor);
      c.rect(2, 2, 28, 28, hex('#636e72'));
      c.rect(4, 4, 12, 10, hex('#2d3436'));
      c.rect(5, 5, 10, 8, hex('#7ed6df'));
      c.rect(18, 4, 10, 10, hex('#1e272e'));
      c.rect(19, 5, 8, 2, hex('#ff4757'));
      c.rect(4, 18, 24, 10, hex('#b2bec3'));
      c.rect(2, 2, 28, 2, primary);
      break;
    case 'corral_rail':
      // Cart corral rail: steel tubes on posts over asphalt.
      c.rect(0, 0, TILE, TILE, hex('#4a4a4f'));
      c.rect(0, 13, TILE, 2, STEEL).rect(0, 18, TILE, 2, STEEL);
      c.rect(0, 12, TILE, 1, INK).rect(0, 20, TILE, 1, INK);
      c.rect(2, 10, 4, 12, primary).rect(26, 10, 4, 12, primary);
      break;
    case 'office_desk':
      c.rect(0, 0, TILE, TILE, hex('#a0703c'));
      box(hex('#dcdde1'), 2, 6, 28, 18);
      c.rect(8, 9, 10, 7, deep).rect(10, 11, 6, 3, hex('#74b9ff'));
      break;
    default:
      throw new Error(`no painter for tile ${name}`);
  }
}
