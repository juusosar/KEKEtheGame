import { describe, expect, it } from 'vitest';
import type { NpcSpawn, Zone } from '../map/mapModel';
import { getNpcCatalogue } from './catalogue';
import { checkNpcMap, planNpcs, type NpcMap } from './placement';

const npcs = getNpcCatalogue();

const spawn = (type: string, x: number, y: number, post = false): NpcSpawn => ({ type, x, y, post });
const zone = (id: string): Zone => ({
  id,
  polygon: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  area: 0,
  wantedOnEnter: false,
});

const map: NpcMap = {
  npcSpawns: [
    spawn('security', 100, 100, true),
    spawn('stocker', 10, 10),
    spawn('security', 200, 200),
    spawn('stocker', 20, 20),
    spawn('butcher', 50, 50),
  ],
  npcWaypoints: [
    { id: 1, name: 'a', x: 0, y: 0 },
    { id: 2, name: 'b', x: 10, y: 0 },
  ],
  forkliftRoutes: [
    {
      id: 1,
      name: 'r1',
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 2 },
      ],
    },
    {
      id: 2,
      name: 'r2',
      points: [
        { x: 5, y: 6 },
        { x: 7, y: 6 },
      ],
    },
    {
      id: 3,
      name: 'r3',
      points: [
        { x: 9, y: 9 },
        { x: 9, y: 11 },
      ],
    },
  ],
  zones: [zone('meat_fish'), zone('behind_counter')],
};

describe('planNpcs', () => {
  it('places the §8 default counts for a small game', () => {
    const plan = planNpcs(npcs, map, 2);
    expect(plan.map((p) => p.key)).toEqual([
      'stocker_1',
      'stocker_2',
      'stocker_3',
      'security_1',
      'security_2',
      'forklift_1',
      'forklift_2',
      'butcher_1',
    ]);
  });

  it('cycles spawns of the type in map order, and only the first NPC at a post stands guard', () => {
    const plan = planNpcs(npcs, map, 12); // 6 stockers, 4 guards
    const stockers = plan.filter((p) => p.type === 'stocker').map((p) => p.spawn);
    expect(stockers).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    const guards = plan.filter((p) => p.type === 'security');
    expect(guards.map((g) => [g.spawn.x, g.post])).toEqual([
      [100, true],
      [200, false],
      [100, false],
      [200, false],
    ]);
    expect(guards.every((g) => g.routeIndex === null && g.behaviour === 'security')).toBe(true);
  });

  it('gives each forklift its own route, starting at the first point', () => {
    const forklifts = planNpcs(npcs, map, 8).filter((p) => p.behaviour === 'forklift');
    expect(forklifts).toEqual([
      {
        key: 'forklift_1',
        type: 'forklift',
        behaviour: 'forklift',
        spawn: { x: 1, y: 2 },
        post: false,
        routeIndex: 0,
      },
      {
        key: 'forklift_2',
        type: 'forklift',
        behaviour: 'forklift',
        spawn: { x: 5, y: 6 },
        post: false,
        routeIndex: 1,
      },
    ]);
  });

  it('caps forklifts at the number of routes and skips types with no spawns', () => {
    const sparse: NpcMap = { ...map, forkliftRoutes: map.forkliftRoutes.slice(0, 1), npcSpawns: [] };
    expect(planNpcs(npcs, sparse, 8).map((p) => p.key)).toEqual(['forklift_1']);
  });

  it('does not share spawn objects with the map', () => {
    const plan = planNpcs(npcs, map, 1);
    expect(plan[0]?.spawn).not.toBe(map.npcSpawns[1]);
  });
});

describe('checkNpcMap', () => {
  it('accepts a map with everything', () => {
    expect(checkNpcMap(npcs, map)).toEqual([]);
  });

  it('reports unknown types, forklift spawns, posts on non-guards and missing spawns', () => {
    const bad: NpcMap = {
      ...map,
      npcSpawns: [spawn('customer', 1, 1), spawn('forklift', 2, 2), spawn('stocker', 3, 3, true)],
    };
    const issues = checkNpcMap(npcs, bad).join('\n');
    expect(issues).toMatch(/unknown NPC type "customer"/);
    expect(issues).toMatch(/forklifts start on forklift_routes/);
    expect(issues).toMatch(/"post" is only used by security guards/);
    expect(issues).toMatch(/security: the map has no npc_spawns/);
    expect(issues).toMatch(/butcher: the map has no npc_spawns/);
  });

  it('reports missing routes, waypoints and butcher zones', () => {
    const bad: NpcMap = { ...map, forkliftRoutes: [], npcWaypoints: [], zones: [zone('meat_fish')] };
    const issues = checkNpcMap(npcs, bad).join('\n');
    expect(issues).toMatch(/forklift: the map has no forklift_routes/);
    expect(issues).toMatch(/stocker: walks between npc_waypoints but the map has 0/);
    expect(issues).toMatch(/security: walks between npc_waypoints/);
    expect(issues).toMatch(/zone "behind_counter" is not in the map's zones layer/);
  });

  it('does not need waypoints when every guard is on a post', () => {
    const posted: NpcMap = {
      ...map,
      npcSpawns: [spawn('security', 1, 1, true), spawn('butcher', 2, 2), spawn('stocker', 3, 3)],
      npcWaypoints: [],
    };
    expect(checkNpcMap(npcs, posted)).toEqual(['stocker: walks between npc_waypoints but the map has 0']);
  });
});
