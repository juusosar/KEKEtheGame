// Checks maps/prisma.tmj (phase 2 P1-4, §9.2, §15.4) through the real map loader, and that the
// committed file is exactly what tools/gen-prisma-map.ts produces (not stale, not hand-edited).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkItemMap, getItemCatalogue } from '../packages/shared/src/items';
import { loadMap, zonesAt, type MapModel } from '../packages/shared/src/map';
import { PRISMA_TILES } from './art/prismaTiles';
import { serializeMap } from './map/kespro';
import {
  ABOVE_TILES,
  buildPrismaMap,
  CORRAL,
  ENTRANCE_DOORS,
  EXIT_DOORS,
  GATE_LANES,
  SOLID_TILES,
} from './map/prisma';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, unknown>;

const config = readJson('packages/shared/src/data/config.json') as { targetMinDistanceFromVanTiles: number };
const tsj = readJson('maps/prisma_tiles.tsj');
const committed = readFileSync(resolve(repoRoot, 'maps/prisma.tmj'), 'utf8');
const raw = JSON.parse(committed) as {
  layers: { name: string; data?: number[] }[];
  tilesets: Record<string, unknown>[];
};
const map: MapModel = loadMap(raw, 'maps/prisma.tmj');
const catalogue = getItemCatalogue('prisma');

// Phase 2 decision 4, written out independently of the generator.
const ZONE_IDS = [
  'produce',
  'bakery',
  'oven',
  'dairy',
  'frozen',
  'pantry',
  'drinks',
  'candy',
  'deli',
  'behind_counter',
  'bottle_return',
  'cart_corral',
  'entrance',
  'self_checkout',
  'stockroom',
  'parking',
  'street',
  'office',
];
const ITEM_ZONES = ['produce', 'bakery', 'dairy', 'frozen', 'pantry', 'drinks', 'candy', 'deli'];
const MIN_SPAWNS_PER_ITEM_ZONE = 5;

const tileOf = (v: number): number => Math.floor(v / map.tileSize);
const zoneById = (id: string) => {
  const zone = map.zones.find((z) => z.id === id);
  if (!zone) throw new Error(`no zone ${id}`);
  return zone;
};
const zoneAtTile = (tx: number, ty: number): string | undefined =>
  map.zoneAt((tx + 0.5) * map.tileSize, (ty + 0.5) * map.tileSize)?.id;

/** Walkable tiles reachable from (tx, ty), 4-connected over the collision grid, optionally with extra walls. */
function floodFill(
  tx: number,
  ty: number,
  blocked: (x: number, y: number) => boolean = () => false,
): Uint8Array {
  const { width, height } = map.collision;
  const seen = new Uint8Array(width * height);
  const stack: [number, number][] = [[tx, ty]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    if (map.collision.isSolid(x, y) || blocked(x, y) || seen[y * width + x] === 1) continue;
    seen[y * width + x] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}
const firstVan = map.vanSlots[0];
if (!firstVan) throw new Error('no van slots');
const reachable = floodFill(tileOf(firstVan.x), tileOf(firstVan.y));
const isReachable = (x: number, y: number, seen = reachable): boolean =>
  seen[tileOf(y) * map.collision.width + tileOf(x)] === 1;

describe('maps/prisma.tmj', () => {
  it('is what the generator produces', () => {
    expect(committed).toBe(serializeMap(buildPrismaMap(tsj)));
  });

  it('is about 100 x 72 tiles of 32 px', () => {
    expect([map.width, map.height, map.tileSize]).toEqual([100, 72, 32]);
  });

  it('has every zone of phase 2 decision 4', () => {
    expect(map.zones.map((z) => z.id).sort()).toEqual([...ZONE_IDS].sort());
  });

  it('has no slippery floor, and only the stockroom is wanted on enter', () => {
    for (const zone of map.zones) {
      expect(zone.friction, zone.id).toBeUndefined();
      expect(zone.speedMultiplier, zone.id).toBeUndefined();
    }
    expect(map.zones.filter((z) => z.wantedOnEnter).map((z) => z.id)).toEqual(['stockroom']);
  });

  it('only the oven floor burns, at the decision 10 rate (P2-2)', () => {
    expect(
      map.zones.filter((z) => z.damagePerSecond !== undefined).map((z) => [z.id, z.damagePerSecond]),
    ).toEqual([['oven', 8]]);
  });

  it('nests the oven in the bakery, behind_counter in the deli and the bottle return in drinks', () => {
    for (const [inner, outer] of [
      ['oven', 'bakery'],
      ['behind_counter', 'deli'],
      ['bottle_return', 'drinks'],
    ] as const) {
      const b = zoneById(inner).bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      expect(map.zoneAt(cx, cy)?.id, inner).toBe(inner);
      expect(
        zonesAt(map.zones, cx, cy).map((z) => z.id),
        inner,
      ).toContain(outer);
    }
  });

  it('has 16 van slots indexed 1 to 16, all in the parking lot', () => {
    expect(map.vanSlots.map((s) => s.index)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (const slot of map.vanSlots) {
      expect(map.zoneAt(slot.x, slot.y)?.id, `van ${slot.index}`).toBe('parking');
      expect(isReachable(slot.x, slot.y), `van ${slot.index}`).toBe(true);
    }
  });

  it('fits the item catalogue (every item zone has spawns)', () => {
    expect(checkItemMap(catalogue, map)).toEqual([]);
  });

  it(`has at least ${MIN_SPAWNS_PER_ITEM_ZONE} item spawns in every item zone, and only there`, () => {
    for (const zone of ITEM_ZONES) {
      expect(map.itemSpawns.filter((s) => s.zone === zone).length, zone).toBeGreaterThanOrEqual(
        MIN_SPAWNS_PER_ITEM_ZONE,
      );
    }
    expect(new Set(map.itemSpawns.map((s) => s.zone))).toEqual(new Set(ITEM_ZONES));
  });

  it('places every item spawn inside its zone, on open floor reachable from the vans', () => {
    for (const s of map.itemSpawns) {
      const where = `${s.zone} spawn at ${tileOf(s.x)},${tileOf(s.y)}`;
      expect(
        zonesAt(map.zones, s.x, s.y).map((z) => z.id),
        where,
      ).toContain(s.zone);
      expect(map.collision.isSolid(tileOf(s.x), tileOf(s.y)), where).toBe(false);
      expect(isReachable(s.x, s.y), where).toBe(true);
    }
  });

  it('puts some deli spawns behind the counter and two drinks spawns in the bottle return', () => {
    const at = (id: string) => map.itemSpawns.filter((s) => map.zoneAt(s.x, s.y)?.id === id);
    expect(at('behind_counter').length).toBeGreaterThanOrEqual(2);
    expect(at('behind_counter').every((s) => s.zone === 'deli')).toBe(true);
    expect(at('bottle_return').map((s) => s.zone)).toEqual(['drinks', 'drinks']);
    expect(map.itemSpawns.some((s) => ['oven', 'stockroom'].includes(map.zoneAt(s.x, s.y)?.id ?? ''))).toBe(
      false,
    );
  });

  it('makes the two bottle-return spawns the odd spots for joke items (decision 11, P2-6)', () => {
    const odd = map.itemSpawns.filter((s) => s.oddSpot);
    expect(odd).toHaveLength(2);
    for (const s of odd) {
      expect(map.zoneAt(s.x, s.y)?.id).toBe('bottle_return');
      expect(isReachable(s.x, s.y)).toBe(true);
    }
  });

  it('hums at the bottle machines (P2-6)', () => {
    expect(map.ambientSounds).toHaveLength(1);
    const hum = map.ambientSounds[0];
    if (!hum) throw new Error('no hum');
    expect(hum.sound).toBe('bottleHum');
    expect(map.collision.isSolid(tileOf(hum.x), tileOf(hum.y))).toBe(true); // on the machine row
    expect(map.zoneAt(hum.x, hum.y - map.tileSize)?.id).toBe('bottle_return');
    // Heard all over the alcove, not from across the store.
    const alcove = zoneById('bottle_return').bounds;
    expect(Math.hypot(alcove.minX - hum.x, alcove.minY - hum.y)).toBeLessThan(hum.radius);
    expect(hum.radius).toBeLessThanOrEqual(12 * map.tileSize);
  });

  it('keeps every item spawn far enough from the vans (§3.1)', () => {
    const min = config.targetMinDistanceFromVanTiles * map.tileSize;
    for (const s of map.itemSpawns) {
      for (const v of map.vanSlots) {
        expect(
          Math.hypot(s.x - v.x, s.y - v.y),
          `spawn ${s.x},${s.y} vs van ${v.index}`,
        ).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('makes the bottle return a dead end (one 2-tile opening)', () => {
    const b = zoneById('bottle_return').bounds;
    const [x0, y0, x1, y1] = [tileOf(b.minX), tileOf(b.minY), tileOf(b.maxX) - 1, tileOf(b.maxY) - 1];
    const openings: string[] = [];
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const border = x < x0 || x > x1 || y < y0 || y > y1;
        if (border && !map.collision.isSolid(x, y) && !(x < x0 && y < y0) && !(x > x1 && y < y0)) {
          openings.push(`${x},${y}`);
        }
      }
    }
    expect(openings.length).toBe(2);
    expect(openings.every((o) => o.endsWith(`,${y0 - 1}`))).toBe(true);
  });

  it('lets shoppers out only through the self-checkout gate lanes (P2-1 puts gates there)', () => {
    // With the gate lanes closed, the store floor cannot reach the exit doors: the exit strip behind
    // the kiosks is only reached through the lanes.
    const checkoutY = tileOf(zoneById('self_checkout').bounds.minY) + 3;
    const lanes = new Set(GATE_LANES.map((x) => `${x},${checkoutY}`));
    const inside = floodFill(10, 30, (x, y) => lanes.has(`${x},${y}`) || y > 42);
    const exitDoorTile = EXIT_DOORS[0];
    expect(inside[41 * map.collision.width + exitDoorTile] ?? 0, 'exit strip sealed').toBe(0);
    expect(inside[42 * map.collision.width + ENTRANCE_DOORS[0]] ?? 0, 'entrance open').toBe(1);
    for (const x of GATE_LANES) {
      expect(map.collision.isSolid(x, checkoutY), `lane ${x}`).toBe(false);
      expect(map.collision.isSolid(x - 1, checkoutY) || GATE_LANES.includes(x - 1), `lane ${x} side`).toBe(
        true,
      );
      expect(zoneAtTile(x, checkoutY)).toBe('self_checkout');
    }
  });

  it('keeps the cart corral pen open on one side and inside the parking lot', () => {
    const [x0, y0, x1, y1] = CORRAL;
    let open = 0;
    for (let y = y0 + 1; y < y1; y++) for (let x = x0; x < x1; x++) if (!map.collision.isSolid(x, y)) open++;
    expect(open).toBeGreaterThanOrEqual(8 * 2); // room for P2-5's 8 carts
    expect(zoneAtTile(x0 + 2, y0 + 2)).toBe('cart_corral');
    expect(isReachable((x0 + 2.5) * map.tileSize, (y0 + 2.5) * map.tileSize)).toBe(true);
  });

  it('starts 8 carts inside the corral, each pushable out of the open west side (P2-5)', () => {
    const [x0, y0, x1, y1] = CORRAL;
    const ts = map.tileSize;
    expect(map.cartSpawns).toHaveLength(8);
    const occupied = new Set(map.cartSpawns.map((c) => `${Math.floor(c.x / ts)},${Math.floor(c.y / ts)}`));
    for (const cart of map.cartSpawns) {
      const tx = Math.floor(cart.x / ts);
      const ty = Math.floor(cart.y / ts);
      expect(tx > x0 && tx < x1 && ty > y0 && ty < y1, `cart at ${tx},${ty}`).toBe(true);
      expect(zoneAtTile(tx, ty)).toBe('cart_corral');
      expect(map.collision.isSolid(tx, ty)).toBe(false);
      expect(cart.dir).toBe('left');
      // A free tile east of the cart to push it from, reachable from the lot.
      expect(map.collision.isSolid(tx + 1, ty)).toBe(false);
      expect(occupied.has(`${tx + 1},${ty}`)).toBe(false);
      expect(isReachable((tx + 1.5) * ts, (ty + 0.5) * ts)).toBe(true);
      // Nothing west of it up to the open side.
      for (let x = x0; x < tx; x++) expect(map.collision.isSolid(x, ty), `west of ${tx},${ty}`).toBe(false);
    }
  });

  it('connects the stockroom to the store through its staff doors', () => {
    const b = zoneById('stockroom').bounds;
    expect(isReachable((b.minX + b.maxX) / 2, b.minY + 2.5 * map.tileSize)).toBe(true);
    let doors = 0;
    for (let ty = tileOf(b.minY); ty < tileOf(b.maxY); ty++)
      if (!map.collision.isSolid(tileOf(b.minX) - 1, ty)) doors++;
    for (let tx = tileOf(b.minX); tx < tileOf(b.maxX); tx++)
      if (!map.collision.isSolid(tx, tileOf(b.maxY))) doors++;
    expect(doors).toBe(4); // two 2-tile staff doors
  });

  it('reaches the office trigger across the road from the vans', () => {
    const b = map.officeTrigger.bounds;
    expect(isReachable((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)).toBe(true);
    expect(map.zoneAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)?.id).toBe('office');
    const street = zoneById('street').bounds;
    expect(b.minX).toBeGreaterThan(street.maxX);
    expect(street.minX).toBeGreaterThan(Math.max(...map.vanSlots.map((v) => v.x)));
  });

  it('uses solid tiles only on the walls layer, above tiles only on the above layer', () => {
    const nameOf = (gid: number): string => PRISMA_TILES[gid - 1]?.name ?? `gid ${gid}`;
    for (const layer of raw.layers) {
      if (!layer.data) continue;
      const names = new Set(layer.data.filter((g) => g !== 0).map(nameOf));
      for (const name of names) {
        expect(
          PRISMA_TILES.some((t) => t.name === name),
          `${layer.name}: ${name}`,
        ).toBe(true);
        if (layer.name === 'walls') expect(SOLID_TILES.has(name), `walls: ${name}`).toBe(true);
        else expect(SOLID_TILES.has(name), `${layer.name}: ${name}`).toBe(false);
        if (layer.name === 'above') expect(ABOVE_TILES.has(name), `above: ${name}`).toBe(true);
      }
      if (layer.name === 'ground') expect(layer.data.includes(0), 'ground has no holes').toBe(false);
    }
  });

  it('paints the oven floor and gate lanes with their own tiles', () => {
    const ground = raw.layers.find((l) => l.name === 'ground')?.data ?? [];
    const nameAt = (x: number, y: number): string | undefined =>
      PRISMA_TILES[(ground[y * map.width + x] ?? 0) - 1]?.name;
    const oven = zoneById('oven').bounds;
    for (let ty = tileOf(oven.minY); ty < tileOf(oven.maxY); ty++) {
      for (let tx = tileOf(oven.minX); tx < tileOf(oven.maxX); tx++) expect(nameAt(tx, ty)).toBe('oven_heat');
    }
    const checkoutY = tileOf(zoneById('self_checkout').bounds.minY) + 3;
    for (const x of GATE_LANES) expect(nameAt(x, checkoutY)).toBe('gate_lane');
  });

  it('embeds the prisma_tiles tileset', () => {
    expect(raw.tilesets).toHaveLength(1);
    const ts = raw.tilesets[0] as Record<string, unknown>;
    expect(ts['firstgid']).toBe(1);
    expect(ts['name']).toBe(tsj['name']);
    expect(ts['tilecount']).toBe(PRISMA_TILES.length);
  });
});
