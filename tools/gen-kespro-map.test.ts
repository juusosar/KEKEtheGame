// Checks maps/kespro.tmj against §9.1 / §15.4 through the real map loader, and that the committed
// file is exactly what tools/gen-kespro-map.ts produces (not stale, not hand-edited).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMap, zonesAt, type MapModel } from '../packages/shared/src/map';
import { TILES } from './art/tiles';
import { ABOVE_TILES, buildKesproMap, serializeMap, SOLID_TILES } from './map/kespro';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, unknown>;

const config = readJson('packages/shared/src/data/config.json') as {
  coldRoomFriction: number;
  coldRoomSpeedMultiplier: number;
  targetMinDistanceFromVanTiles: number;
};
const tsj = readJson('maps/kespro_tiles.tsj');
const committed = readFileSync(resolve(repoRoot, 'maps/kespro.tmj'), 'utf8');
const raw = JSON.parse(committed) as {
  layers: { name: string; data?: number[] }[];
  tilesets: Record<string, unknown>[];
};
const map: MapModel = loadMap(raw, 'maps/kespro.tmj');

// §9.1, written out independently of the generator.
const ZONE_IDS = [
  'loading_dock',
  'entrance',
  'dry_goods',
  'beverages',
  'cold_room',
  'frozen',
  'meat_fish',
  'behind_counter',
  'staff_only',
  'parking',
  'office',
];
const ITEM_ZONES = ['dry_goods', 'beverages', 'cold_room', 'frozen', 'meat_fish'];
const MIN_SPAWNS_PER_ITEM_ZONE = 8;

const tileOf = (v: number): number => Math.floor(v / map.tileSize);
const zoneById = (id: string) => {
  const zone = map.zones.find((z) => z.id === id);
  if (!zone) throw new Error(`no zone ${id}`);
  return zone;
};

/** Walkable tiles reachable from (tx, ty), 4-connected over the collision grid. */
function floodFill(tx: number, ty: number): Uint8Array {
  const { width, height } = map.collision;
  const seen = new Uint8Array(width * height);
  const stack: [number, number][] = [[tx, ty]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    if (map.collision.isSolid(x, y) || seen[y * width + x] === 1) continue;
    seen[y * width + x] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}
const firstVan = map.vanSlots[0];
if (!firstVan) throw new Error('no van slots');
const reachable = floodFill(tileOf(firstVan.x), tileOf(firstVan.y));
const isReachable = (x: number, y: number): boolean =>
  reachable[tileOf(y) * map.collision.width + tileOf(x)] === 1;

describe('maps/kespro.tmj', () => {
  it('is what the generator produces', () => {
    expect(committed).toBe(serializeMap(buildKesproMap(config, tsj)));
  });

  it('is 96 x 64 tiles of 32 px (tightened from 120 x 80, 2026-11-11)', () => {
    expect([map.width, map.height, map.tileSize]).toEqual([96, 64, 32]);
  });

  it('has every zone from §9.1', () => {
    expect(map.zones.map((z) => z.id).sort()).toEqual([...ZONE_IDS].sort());
  });

  it('gives the cold room the configured slippery floor', () => {
    const cold = zoneById('cold_room');
    expect(cold.friction).toBe(config.coldRoomFriction);
    expect(cold.speedMultiplier).toBe(config.coldRoomSpeedMultiplier);
    for (const zone of map.zones.filter((z) => z.id !== 'cold_room')) {
      expect(zone.friction, zone.id).toBeUndefined();
      expect(zone.speedMultiplier, zone.id).toBeUndefined();
    }
  });

  it('makes only the staff-only room wanted on enter', () => {
    expect(map.zones.filter((z) => z.wantedOnEnter).map((z) => z.id)).toEqual(['staff_only']);
  });

  it('has 16 van slots indexed 1 to 16, all on the loading dock', () => {
    expect(map.vanSlots.map((s) => s.index)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (const slot of map.vanSlots) {
      expect(map.zoneAt(slot.x, slot.y)?.id, `van ${slot.index}`).toBe('loading_dock');
      expect(isReachable(slot.x, slot.y), `van ${slot.index}`).toBe(true);
    }
  });

  it(`has at least ${MIN_SPAWNS_PER_ITEM_ZONE} item spawns in every item zone, and only there`, () => {
    for (const zone of ITEM_ZONES) {
      expect(map.itemSpawns.filter((s) => s.zone === zone).length, zone).toBeGreaterThanOrEqual(
        MIN_SPAWNS_PER_ITEM_ZONE,
      );
    }
    expect(new Set(map.itemSpawns.map((s) => s.zone))).toEqual(new Set(ITEM_ZONES));
  });

  it('parks the vans around the middle of the west edge, filling from the middle outwards', () => {
    const midY = (map.height * map.tileSize) / 2;
    const offMiddle = map.vanSlots.map((s) => Math.abs(s.y - midY) / map.tileSize);
    // Every van sits in the middle half of the map's height, and slots 1 to 4 are the four closest.
    for (const [i, d] of offMiddle.entries()) expect(d, `van ${i + 1}`).toBeLessThanOrEqual(map.height / 4);
    expect(Math.max(...offMiddle.slice(0, 4))).toBeLessThanOrEqual(Math.min(...offMiddle.slice(4)));
    for (const s of map.vanSlots) expect(s.x / map.tileSize, `van ${s.index}`).toBeLessThan(10);
  });

  it('names its own team slots, 5 and 6, at least 8 tiles apart (P1 review F3)', () => {
    expect(map.teamVanSlots.map((i) => map.vanSlots[i]?.index)).toEqual([5, 6]);
    const [a, b] = map.teamVanSlots.map((i) => map.vanSlots[i]);
    if (!a || !b) throw new Error('no team vans');
    expect(Math.hypot(a.x - b.x, a.y - b.y) / map.tileSize).toBeGreaterThanOrEqual(8);
  });

  it('places every item spawn inside its zone, on open floor reachable from the dock', () => {
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

  it('marks 2 to 4 odd spots for joke items (§10.1, P2-6), one behind the butcher counter', () => {
    const odd = map.itemSpawns.filter((s) => s.oddSpot);
    expect(odd.length).toBeGreaterThanOrEqual(2);
    expect(odd.length).toBeLessThanOrEqual(4);
    for (const s of odd) expect(isReachable(s.x, s.y), `odd spot ${tileOf(s.x)},${tileOf(s.y)}`).toBe(true);
    expect(odd.some((s) => map.zoneAt(s.x, s.y)?.id === 'behind_counter')).toBe(true);
  });

  it('has no ambient sounds', () => {
    expect(map.ambientSounds).toEqual([]);
  });

  it('puts some meat & fish spawns behind the counter', () => {
    const behind = map.itemSpawns.filter((s) => map.zoneAt(s.x, s.y)?.id === 'behind_counter');
    expect(behind.length).toBeGreaterThanOrEqual(2);
    expect(behind.every((s) => s.zone === 'meat_fish')).toBe(true);
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

  it('connects the staff-only room to both the dock and the store', () => {
    const staff = zoneById('staff_only');
    // Doorways are open tiles in the wall columns just west (dock) and east (store) of the room.
    const westWall = tileOf(staff.bounds.minX) - 1;
    const eastWall = tileOf(staff.bounds.maxX);
    const rows: number[] = [];
    for (let ty = tileOf(staff.bounds.minY); ty < tileOf(staff.bounds.maxY); ty++) rows.push(ty);
    expect(
      rows.filter((ty) => !map.collision.isSolid(westWall, ty)).length,
      'door to the dock',
    ).toBeGreaterThan(0);
    expect(
      rows.filter((ty) => !map.collision.isSolid(eastWall, ty)).length,
      'door to the store',
    ).toBeGreaterThan(0);
    expect(map.zoneAt((westWall - 1 + 0.5) * map.tileSize, (rows[4] ?? 0) * map.tileSize)?.id).toBe(
      'loading_dock',
    );
  });

  it('reaches the office trigger from the dock', () => {
    const b = map.officeTrigger.bounds;
    expect(isReachable((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)).toBe(true);
    expect(map.zoneAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)?.id).toBe('office');
  });

  it('has NPC spawns for stockers, security and the butcher behind the counter', () => {
    const types = new Set(map.npcSpawns.map((n) => n.type));
    expect(types).toEqual(new Set(['stocker', 'security', 'butcher']));
    for (const n of map.npcSpawns) {
      expect(map.collision.isSolid(tileOf(n.x), tileOf(n.y)), `${n.type} at ${n.x},${n.y}`).toBe(false);
    }
    const butcher = map.npcSpawns.find((n) => n.type === 'butcher');
    expect(butcher && map.zoneAt(butcher.x, butcher.y)?.id).toBe('behind_counter');
    expect(map.npcWaypoints.length).toBeGreaterThan(0);
    for (const w of map.npcWaypoints) expect(isReachable(w.x, w.y), w.name).toBe(true);
  });

  it('has two forklift loops (dry goods and beverages) that never cross a solid tile', () => {
    expect(map.forkliftRoutes.length).toBe(2);
    const zonesOf = map.forkliftRoutes.map((r) => map.zoneAt(r.points[0]?.x ?? 0, r.points[0]?.y ?? 0)?.id);
    expect(zonesOf.sort()).toEqual(['beverages', 'dry_goods']);
    for (const route of map.forkliftRoutes) {
      const pts = [...route.points, route.points[0]];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (!a || !b) continue;
        expect(a.x === b.x || a.y === b.y, `${route.name} segment ${i} is axis-aligned`).toBe(true);
        const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / map.tileSize;
        for (let s = 0; s <= steps; s++) {
          const x = a.x + ((b.x - a.x) * s) / steps;
          const y = a.y + ((b.y - a.y) * s) / steps;
          expect(map.collision.isSolid(tileOf(x), tileOf(y)), `${route.name} at ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it('uses solid tiles only on the walls layer, above tiles only on the above layer', () => {
    const nameOf = (gid: number): string => TILES[gid - 1]?.name ?? `gid ${gid}`;
    for (const layer of raw.layers) {
      if (!layer.data) continue;
      const names = new Set(layer.data.filter((g) => g !== 0).map(nameOf));
      for (const name of names) {
        expect(
          TILES.some((t) => t.name === name),
          `${layer.name}: ${name}`,
        ).toBe(true);
        if (layer.name === 'walls') expect(SOLID_TILES.has(name), `walls: ${name}`).toBe(true);
        else expect(SOLID_TILES.has(name), `${layer.name}: ${name}`).toBe(false);
        if (layer.name === 'above') expect(ABOVE_TILES.has(name), `above: ${name}`).toBe(true);
      }
      if (layer.name === 'ground') expect(layer.data.includes(0), 'ground has no holes').toBe(false);
    }
  });

  it('embeds the kespro_tiles tileset', () => {
    expect(raw.tilesets).toHaveLength(1);
    const ts = raw.tilesets[0] as Record<string, unknown>;
    expect(ts['firstgid']).toBe(1);
    expect(ts['name']).toBe(tsj['name']);
    expect(ts['tilecount']).toBe(TILES.length);
  });
});
