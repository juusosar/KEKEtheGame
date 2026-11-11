// Race mode (§4.2) on the real kespro map: the office trigger exists across the street, every van can
// reach it on foot through the store, and the office has a zone for the minimap marker.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../packages/shared/src/config';
import { inOfficeTrigger, loadMap } from '../packages/shared/src/map';
import { findPath, findTilePath, tileOf } from '../packages/shared/src/rules/pathfinding';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const map = loadMap(
  JSON.parse(readFileSync(resolve(repoRoot, 'maps/kespro.tmj'), 'utf8')),
  'maps/kespro.tmj',
);
const config = loadConfig();
const poly = map.officeTrigger.polygon;
const centre = {
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
};

describe('race mode on the kespro map', () => {
  it('has the office trigger inside the office zone, east of the store', () => {
    expect(inOfficeTrigger(map, centre.x, centre.y)).toBe(true);
    const office = map.zones.find((z) => z.id === 'office');
    expect(office).toBeDefined();
    expect(Math.min(...poly.map((p) => p.x))).toBeGreaterThan(Math.max(...map.vanSlots.map((v) => v.x)));
  });

  it('every van slot reaches the office trigger on foot', () => {
    const half = config.playerHitboxSize / 2;
    for (const van of map.vanSlots) {
      const tiles = findTilePath(map.collision, tileOf(map.collision, van), tileOf(map.collision, centre));
      expect(tiles, `van ${van.index}`).not.toBeNull();
      expect(findPath(map.collision, van, centre, { radius: half }), `van ${van.index}`).not.toBeNull();
    }
  });
});

/** 8-way walking distance in tiles from `from` to every tile (diagonals never cut a wall corner). */
function walkFrom(from: { x: number; y: number }): Float64Array {
  const grid = map.collision;
  const { width, tileSize } = grid;
  const dist = new Float64Array(width * grid.height).fill(Infinity);
  const start = Math.floor(from.y / tileSize) * width + Math.floor(from.x / tileSize);
  dist[start] = 0;
  const done = new Uint8Array(dist.length);
  const open = [start];
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++)
      if ((dist[open[i] ?? 0] ?? 0) < (dist[open[best] ?? 0] ?? 0)) best = i;
    const cell = open.splice(best, 1)[0] ?? 0;
    if (done[cell] === 1) continue;
    done[cell] = 1;
    const cx = cell % width;
    const cy = Math.floor(cell / width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      if (grid.isSolid(cx + dx, cy + dy)) continue;
      if (dx !== 0 && dy !== 0 && (grid.isSolid(cx + dx, cy) || grid.isSolid(cx, cy + dy))) continue;
      const next = (cy + dy) * width + cx + dx;
      const d = (dist[cell] ?? 0) + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (d < (dist[next] ?? Infinity)) {
        dist[next] = d;
        open.push(next);
      }
    }
  }
  return dist;
}

describe('team vans on the kespro map (P1 review F3)', () => {
  const grid = map.collision;
  const at = (dist: Float64Array, p: { x: number; y: number }): number =>
    dist[Math.floor(p.y / grid.tileSize) * grid.width + Math.floor(p.x / grid.tileSize)] ?? Infinity;
  const walks = map.teamVanSlots.map((slot) => {
    const van = map.vanSlots[slot];
    if (!van) throw new Error(`no van slot ${slot}`);
    const dist = walkFrom(van);
    const items = map.itemSpawns.reduce((sum, s) => sum + at(dist, s), 0) / map.itemSpawns.length;
    return { items, office: at(dist, centre) };
  });

  it('gives both teams about the same walk to the item spawns and to the office (within 15 %)', () => {
    const [a, b] = walks;
    if (!a || !b) throw new Error('no team vans');
    for (const key of ['items', 'office'] as const) {
      expect(Number.isFinite(a[key]) && Number.isFinite(b[key]), key).toBe(true);
      expect(Math.abs(a[key] - b[key]) / Math.min(a[key], b[key]), key).toBeLessThanOrEqual(0.15);
    }
  });
});
