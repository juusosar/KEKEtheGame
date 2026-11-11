// Play rules on the real prisma map (phase 2 P1-4): store workers (§8 with the map's NPC overrides),
// race mode (§4.2) and target assignment (§3.1) with the phase 2 item catalogue. Mirrors
// tools/kespro-npcs.test.ts, kespro-race.test.ts and kespro-targets.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../packages/shared/src/config';
import { getItemCatalogue } from '../packages/shared/src/items';
import { inOfficeTrigger, loadMap } from '../packages/shared/src/map';
import {
  checkNpcMap,
  getNpcCatalogue,
  npcCatalogueForMap,
  npcRoster,
  planNpcs,
} from '../packages/shared/src/npcs';
import { createRng } from '../packages/shared/src/rng';
import { addCarryPlayer, assignTargets, createItemWorld } from '../packages/shared/src/rules/carry';
import { aabbOverlapsSolid } from '../packages/shared/src/rules/collision';
import { advanceAlongPath, findPath, findTilePath, tileOf } from '../packages/shared/src/rules/pathfinding';
import { eligibleSpawns, spawnsForItem } from '../packages/shared/src/rules/targets';
import type { Vec2 } from '../packages/shared/src/types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const map = loadMap(
  JSON.parse(readFileSync(resolve(repoRoot, 'maps/prisma.tmj'), 'utf8')),
  'maps/prisma.tmj',
);
const npcs = npcCatalogueForMap(getNpcCatalogue(), 'prisma');
const config = loadConfig();
const grid = map.collision;

/** The value, or a test failure when it is missing. */
function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

describe('NPCs on the prisma map', () => {
  it('has everything npcs.json needs, with the deli as the butcher home', () => {
    expect(checkNpcMap(npcs, map)).toEqual([]);
    expect(npcRoster(npcs, map)).toEqual(['stocker', 'security', 'forklift', 'butcher']);
    expect(npcs.require('butcher')).toMatchObject({ homeZone: 'deli', guardZone: 'behind_counter' });
  });

  it('puts a security guard on a post at the stockroom door', () => {
    const posts = map.npcSpawns.filter((s) => s.post);
    expect(posts.map((s) => s.type)).toEqual(['security']);
    const post = must(posts[0]);
    const b = must(map.zones.find((z) => z.id === 'stockroom')).bounds;
    const gap = Math.max(b.minX - post.x, post.x - b.maxX, b.minY - post.y, post.y - b.maxY);
    expect(gap, 'post is within 3 tiles of the stockroom').toBeLessThanOrEqual(3 * map.tileSize);
    expect(map.zoneAt(post.x, post.y)?.id).not.toBe('stockroom');
  });

  it('places the §8 counts (one forklift route) for 1 to maxPlayersPerRoom players on walkable floor', () => {
    for (let players = 1; players <= config.maxPlayersPerRoom; players++) {
      const plan = planNpcs(npcs, map, players);
      const count = (type: string): number => plan.filter((p) => p.type === type).length;
      expect(count('stocker')).toBe(Math.max(3, Math.floor(players / 2)));
      expect(count('security')).toBe(2 + Math.floor(players / 6));
      expect(count('forklift')).toBe(1);
      expect(count('butcher')).toBe(1);
      for (const p of plan) {
        const half = npcs.require(p.type).hitboxPx / 2;
        expect(aabbOverlapsSolid(grid, p.spawn, { hw: half, hh: half }), p.key).toBe(false);
      }
    }
  });

  it('starts the butcher behind the deli counter, inside its home zone', () => {
    const spawn = must(planNpcs(npcs, map, 8).find((p) => p.behaviour === 'butcher')).spawn;
    expect(map.zoneAt(spawn.x, spawn.y)?.id).toBe('behind_counter');
    const home = must(map.zones.find((z) => z.id === 'deli')).bounds;
    const guard = must(map.zones.find((z) => z.id === 'behind_counter')).bounds;
    expect(guard.minX).toBeGreaterThanOrEqual(home.minX);
    expect(guard.maxX).toBeLessThanOrEqual(home.maxX);
    expect(guard.minY).toBeGreaterThanOrEqual(home.minY);
    expect(guard.maxY).toBeLessThanOrEqual(home.maxY);
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

  it('walks a stocker through the narrow aisles between far-apart waypoints without touching a wall', () => {
    const stocker = npcs.require('stocker');
    const radius = stocker.hitboxPx / 2;
    const half = { hw: radius, hh: radius };
    const wps = map.npcWaypoints;
    for (const [a, b] of [
      [must(wps[0]), must(wps.at(-1))],
      [must(wps[2]), must(wps[14])],
      [must(wps[5]), must(wps[12])],
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

  it('runs one forklift loop inside the stockroom, clear of walls', () => {
    expect(map.forkliftRoutes).toHaveLength(1);
    const route = must(map.forkliftRoutes[0]);
    const half = npcs.require('forklift').hitboxPx / 2;
    const loop = [...route.points, must(route.points[0])];
    let pos = must(loop[0]);
    let left: readonly Vec2[] = loop.slice(1);
    while (left.length > 0) {
      const step = advanceAlongPath(pos, left, 4);
      pos = step.position;
      left = step.path;
      expect(aabbOverlapsSolid(grid, pos, { hw: half, hh: half }), `${route.name} at ${pos.x},${pos.y}`).toBe(
        false,
      );
      expect(map.zoneAt(pos.x, pos.y)?.id, `${route.name} at ${pos.x},${pos.y}`).toBe('stockroom');
    }
  });
});

describe('race mode on the prisma map', () => {
  const poly = map.officeTrigger.polygon;
  const centre = {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };

  it('has the office trigger inside the office zone, across the road from the vans', () => {
    expect(inOfficeTrigger(map, centre.x, centre.y)).toBe(true);
    expect(map.zoneAt(centre.x, centre.y)?.id).toBe('office');
    expect(Math.min(...poly.map((p) => p.x))).toBeGreaterThan(Math.max(...map.vanSlots.map((v) => v.x)));
  });

  it('every van slot reaches the office trigger on foot', () => {
    const half = config.playerHitboxSize / 2;
    for (const van of map.vanSlots) {
      expect(findTilePath(grid, tileOf(grid, van), tileOf(grid, centre)), `van ${van.index}`).not.toBeNull();
      expect(findPath(grid, van, centre, { radius: half }), `van ${van.index}`).not.toBeNull();
    }
  });
});

describe('target assignment on the prisma map', () => {
  const catalogue = getItemCatalogue('prisma');

  it('every catalogue item has at least one eligible spawn', () => {
    const free = eligibleSpawns(map, [], config);
    for (const item of catalogue.items) expect(spawnsForItem(item, free).length, item.id).toBeGreaterThan(0);
  });

  it('gives all maxPlayersPerRoom players a target far enough from every van', () => {
    let world = createItemWorld();
    for (let i = 0; i < config.maxPlayersPerRoom; i++) world = addCarryPlayer(world, `p${i}`, i + 1);
    world = assignTargets(world, { catalogue: catalogue.items, map, rng: createRng(2026), config }).world;
    expect(world.players.every((p) => p.target !== null)).toBe(true);
    const minDist = config.targetMinDistanceFromVanTiles * map.tileSize;
    for (const item of world.items) {
      for (const van of map.vanSlots) {
        expect(Math.hypot(item.x - van.x, item.y - van.y)).toBeGreaterThanOrEqual(minDist);
      }
    }
  });

  it('sends joke items to the bottle-return odd spots first, then anywhere (P2-6)', () => {
    let world = createItemWorld();
    for (let i = 0; i < 4; i++) world = addCarryPlayer(world, `p${i}`, i + 1);
    const jokes = { ...config, jokeItemChance: 1 };
    world = assignTargets(world, { catalogue: catalogue.items, map, rng: createRng(7), config: jokes }).world;
    expect(world.items.map((i) => i.rarity)).toEqual(['joke', 'joke', 'joke', 'joke']);
    const zones = world.items.map((i) => map.zoneAt(i.x, i.y)?.id);
    // Two odd spots: the first two jokes take them, the other two land elsewhere.
    expect(zones.filter((z) => z === 'bottle_return')).toHaveLength(2);
  });

  it('every item spawn is reachable on foot from every van by a player', () => {
    const half = config.playerHitboxSize / 2;
    const van = must(map.vanSlots[0]);
    for (const s of map.itemSpawns) {
      expect(findPath(grid, van, s, { radius: half }), `${s.zone} at ${s.x},${s.y}`).not.toBeNull();
    }
  });
});
