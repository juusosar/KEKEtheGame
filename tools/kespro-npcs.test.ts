// NPC data (§8) on the real kespro map: the map has what every NPC type needs, the planned NPCs start on
// walkable floor, walkers can path between every waypoint, and forklift routes fit the forklift.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../packages/shared/src/config';
import { loadMap } from '../packages/shared/src/map';
import { checkNpcMap, getNpcCatalogue, planNpcs } from '../packages/shared/src/npcs';
import { aabbOverlapsSolid } from '../packages/shared/src/rules/collision';
import { advanceAlongPath, findPath, findTilePath, tileOf } from '../packages/shared/src/rules/pathfinding';
import type { Vec2 } from '../packages/shared/src/types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const map = loadMap(
  JSON.parse(readFileSync(resolve(repoRoot, 'maps/kespro.tmj'), 'utf8')),
  'maps/kespro.tmj',
);
const npcs = getNpcCatalogue();
const config = loadConfig();
const grid = map.collision;

/** The value, or a test failure when it is missing. */
function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

describe('NPCs on the kespro map', () => {
  it('has everything npcs.json needs', () => {
    expect(checkNpcMap(npcs, map)).toEqual([]);
  });

  it('puts a security guard on a post at the staff-only door', () => {
    const posts = map.npcSpawns.filter((s) => s.post);
    expect(posts.map((s) => s.type)).toEqual(['security']);
    const post = posts[0] as Vec2;
    const staff = map.zones.find((z) => z.id === 'staff_only');
    expect(staff).toBeDefined();
    const b = must(staff).bounds;
    const gap = Math.max(b.minX - post.x, post.x - b.maxX, b.minY - post.y, post.y - b.maxY);
    expect(gap, 'post is within 3 tiles of the staff-only room').toBeLessThanOrEqual(3 * map.tileSize);
  });

  it('places the §8 counts for 1 to maxPlayersPerRoom players on walkable floor', () => {
    for (let players = 1; players <= config.maxPlayersPerRoom; players++) {
      const plan = planNpcs(npcs, map, players);
      const count = (type: string): number => plan.filter((p) => p.type === type).length;
      expect(count('stocker')).toBe(Math.max(3, Math.floor(players / 2)));
      expect(count('security')).toBe(2 + Math.floor(players / 6));
      expect(count('forklift')).toBe(2);
      expect(count('butcher')).toBe(1);
      for (const p of plan) {
        const half = npcs.require(p.type).hitboxPx / 2;
        expect(aabbOverlapsSolid(grid, p.spawn, { hw: half, hh: half }), p.key).toBe(false);
      }
    }
  });

  it('starts the butcher inside its guard zone, inside its home zone', () => {
    const butcher = must(npcs.ofBehaviour('butcher')[0]);
    const spawn = must(planNpcs(npcs, map, 8).find((p) => p.behaviour === 'butcher')).spawn;
    expect(map.zoneAt(spawn.x, spawn.y)?.id).toBe(butcher.guardZone);
    const home = must(map.zones.find((z) => z.id === butcher.homeZone));
    const guard = must(map.zones.find((z) => z.id === butcher.guardZone));
    expect(guard.bounds.minX).toBeGreaterThanOrEqual(home.bounds.minX);
    expect(guard.bounds.maxX).toBeLessThanOrEqual(home.bounds.maxX);
    expect(guard.bounds.minY).toBeGreaterThanOrEqual(home.bounds.minY);
    expect(guard.bounds.maxY).toBeLessThanOrEqual(home.bounds.maxY);
  });

  it('lets a walker path from every stocker and guard spawn to every waypoint and back', () => {
    const walkers = map.npcSpawns.filter((s) => s.type === 'stocker' || s.type === 'security');
    const points: Vec2[] = [...walkers, ...map.npcWaypoints];
    const first = must(map.npcWaypoints[0]);
    for (const p of points) {
      expect(findTilePath(grid, tileOf(grid, first), tileOf(grid, p)), `${p.x},${p.y}`).not.toBeNull();
      expect(findTilePath(grid, tileOf(grid, p), tileOf(grid, first)), `${p.x},${p.y}`).not.toBeNull();
    }
  });

  it('walks a stocker between far-apart waypoints without touching a wall', () => {
    const stocker = npcs.require('stocker');
    const radius = stocker.hitboxPx / 2;
    const half = { hw: radius, hh: radius };
    const wps = map.npcWaypoints;
    for (const [a, b] of [
      [must(wps[0]), must(wps.at(-1))],
      [must(wps[2]), must(wps[13])],
    ] as const) {
      const path = findPath(grid, a, b, { radius });
      expect(path, `${a.name} -> ${b.name}`).not.toBeNull();
      let pos: Vec2 = a;
      let left: readonly Vec2[] = must(path);
      while (left.length > 0) {
        const step = advanceAlongPath(pos, left, stocker.speedPxPerSecond / config.serverTickHz);
        pos = step.position;
        left = step.path;
        expect(aabbOverlapsSolid(grid, pos, half), `${a.name} -> ${b.name} at ${pos.x},${pos.y}`).toBe(false);
      }
      expect(pos).toEqual({ x: b.x, y: b.y });
    }
  });

  it('keeps a whole forklift clear of walls along every route', () => {
    const half = npcs.require('forklift').hitboxPx / 2;
    for (const route of map.forkliftRoutes) {
      const loop = [...route.points, must(route.points[0])];
      let pos = must(loop[0]);
      let left: readonly Vec2[] = loop.slice(1);
      while (left.length > 0) {
        const step = advanceAlongPath(pos, left, 4);
        pos = step.position;
        left = step.path;
        expect(
          aabbOverlapsSolid(grid, pos, { hw: half, hh: half }),
          `${route.name} at ${pos.x},${pos.y}`,
        ).toBe(false);
      }
    }
  });

  it('finds any path on the map quickly enough for a 20 Hz server', () => {
    const wps = map.npcWaypoints;
    const start = performance.now();
    let found = 0;
    for (const a of wps)
      for (const b of wps) if (findTilePath(grid, tileOf(grid, a), tileOf(grid, b))) found++;
    const perPath = (performance.now() - start) / (wps.length * wps.length);
    expect(found).toBe(wps.length * wps.length);
    // Generous bound so slow CI boxes pass; real numbers go in the handoff.
    expect(perPath).toBeLessThan(20);
  });
});
