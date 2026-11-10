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
