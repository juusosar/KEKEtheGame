import { describe, expect, it } from 'vitest';
import fixture from './fixtures/test-map.json';
import type { CollisionGrid, MovementMap } from '../index';
import { MapError, OBJECT_LAYERS, TILE_LAYERS, inOfficeTrigger, loadMap, zonesAt } from './index';

/** A deep copy of the fixture that a test can break without affecting the others. */
function cloneFixture(): typeof fixture {
  return structuredClone(fixture);
}

type AnyLayer = { name: string; type: string; layers?: AnyLayer[]; objects?: Record<string, unknown>[] };

/** Finds a layer by name, looking inside group layers too. */
function layerOf(map: { layers: unknown[] }, name: string): AnyLayer {
  const walk = (layers: AnyLayer[]): AnyLayer | undefined => {
    for (const l of layers) {
      if (l.name === name) return l;
      const inner = l.layers ? walk(l.layers) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  const found = walk(map.layers as AnyLayer[]);
  if (!found) throw new Error(`fixture has no layer ${name}`);
  return found;
}

function removeLayer(map: { layers: unknown[] }, name: string): void {
  const strip = (layers: AnyLayer[]): AnyLayer[] =>
    layers.filter((l) => l.name !== name).map((l) => (l.layers ? { ...l, layers: strip(l.layers) } : l));
  map.layers = strip(map.layers as AnyLayer[]);
}

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadMap(raw, 'test-map');
  } catch (e) {
    expect(e).toBeInstanceOf(MapError);
    return (e as MapError).issues;
  }
  throw new Error('expected loadMap to throw');
}

const map = loadMap(fixture, 'test-map');
const T = 32;
/** Pixel centre of tile (tx, ty). */
const c = (t: number): number => t * T + T / 2;

describe('loadMap: dimensions', () => {
  it('reads size in tiles and pixels', () => {
    expect(map).toMatchObject({ width: 12, height: 10, tileSize: 32, widthPx: 384, heightPx: 320 });
  });
});

describe('loadMap: tile layers', () => {
  it('builds the collision grid from walls', () => {
    const grid = map.collision;
    expect(grid).toMatchObject({ width: 12, height: 10, tileSize: 32 });
    expect(grid.solid).toHaveLength(120);
    expect(grid.isSolid(0, 0)).toBe(true); // border
    expect(grid.isSolid(11, 9)).toBe(true);
    expect(grid.isSolid(1, 1)).toBe(false); // floor
    expect(grid.isSolid(6, 1)).toBe(true); // interior wall
    expect(grid.isSolid(6, 5)).toBe(false);
  });

  it('ignores Tiled flip flags when reading wall gids', () => {
    expect(map.collision.isSolid(6, 2)).toBe(true);
  });

  it('treats out-of-bounds and fractional tiles as solid', () => {
    expect(map.collision.isSolid(-1, 3)).toBe(true);
    expect(map.collision.isSolid(3, -1)).toBe(true);
    expect(map.collision.isSolid(12, 3)).toBe(true);
    expect(map.collision.isSolid(3, 10)).toBe(true);
    expect(map.collision.isSolid(1.5, 1)).toBe(true);
  });

  it('finds tile layers nested in a group layer', () => {
    // decor and above live inside the "overlay" group in the fixture; loading succeeds only if found.
    expect(layerOf(fixture, 'overlay').type).toBe('group');
    expect(() => loadMap(fixture)).not.toThrow();
  });
});

describe('loadMap: zones', () => {
  it('reads every zone with its id and properties', () => {
    expect(map.zones.map((z) => z.id)).toEqual([
      'loading_dock',
      'cold_room',
      'meat_fish',
      'behind_counter',
      'staff_only',
    ]);
    const cold = map.zones.find((z) => z.id === 'cold_room');
    expect(cold).toMatchObject({ friction: 0.92, speedMultiplier: 0.9, wantedOnEnter: false });
    const staff = map.zones.find((z) => z.id === 'staff_only');
    expect(staff?.wantedOnEnter).toBe(true);
    expect(staff && 'friction' in staff).toBe(false);
  });

  it('turns rectangles and polygons into absolute vertices', () => {
    const dock = map.zones.find((z) => z.id === 'loading_dock');
    expect(dock?.polygon).toEqual([
      { x: 32, y: 32 },
      { x: 192, y: 32 },
      { x: 192, y: 160 },
      { x: 32, y: 160 },
    ]);
    expect(dock?.bounds).toEqual({ minX: 32, minY: 32, maxX: 192, maxY: 160 });
    const counter = map.zones.find((z) => z.id === 'behind_counter');
    expect(counter?.polygon[0]).toEqual({ x: 96, y: 192 });
    expect(counter?.area).toBe(64 * 64);
  });
});

describe('zoneAt', () => {
  it('returns the zone containing a point', () => {
    expect(map.zoneAt(c(2), c(2))?.id).toBe('loading_dock');
    expect(map.zoneAt(c(8), c(2))?.id).toBe('cold_room');
    expect(map.zoneAt(c(8), c(6))?.id).toBe('staff_only');
  });

  it('returns undefined outside every zone', () => {
    expect(map.zoneAt(5, 5)).toBeUndefined();
    expect(map.zoneAt(-100, -100)).toBeUndefined();
  });

  it('prefers the smallest zone where zones nest', () => {
    expect(map.zoneAt(c(4), c(7))?.id).toBe('behind_counter');
    expect(map.zoneAt(c(1), c(7))?.id).toBe('meat_fish');
    expect(zonesAt(map.zones, c(4), c(7)).map((z) => z.id)).toEqual(['behind_counter', 'meat_fish']);
  });

  it('gives a shared edge to exactly one zone', () => {
    // cold_room ends and staff_only starts at y = 160.
    expect(map.zoneAt(c(8), 160)?.id).toBe('staff_only');
    expect(map.zoneAt(c(8), 159.9)?.id).toBe('cold_room');
  });
});

describe('loadMap: object layers', () => {
  it('reads van slots sorted by index', () => {
    expect(map.vanSlots).toEqual([
      { index: 0, x: 80, y: 48 },
      { index: 1, x: 48, y: 48 },
    ]);
  });

  it('reads item spawns with their zone', () => {
    expect(map.itemSpawns).toEqual([
      { x: 256, y: 64, zone: 'cold_room', oddSpot: false },
      { x: 64, y: 224, zone: 'meat_fish', oddSpot: false },
      { x: 128, y: 224, zone: 'behind_counter', oddSpot: false },
    ]);
  });

  it('reads the optional item spawn oddSpot flag and rejects a non-boolean one', () => {
    const raw = cloneFixture();
    const spawn = (layerOf(raw, 'item_spawns').objects as { id: number; properties?: unknown[] }[])[2] as {
      id: number;
      properties: unknown[];
    };
    spawn.properties.push({ name: 'oddSpot', type: 'bool', value: true });
    expect(loadMap(raw, 'test-map').itemSpawns.map((s) => s.oddSpot)).toEqual([false, false, true]);
    spawn.properties = [
      { name: 'zone', type: 'string', value: 'behind_counter' },
      { name: 'oddSpot', type: 'string', value: 'yes' },
    ];
    expect(issuesOf(raw).join('\n')).toMatch(
      new RegExp(`item_spawns #${spawn.id}: property "oddSpot" must be a boolean`),
    );
  });

  it('has no ambient sounds when the optional ambient_sounds layer is missing', () => {
    expect(map.ambientSounds).toEqual([]);
  });

  it('reads ambient sounds and checks their sound and radius', () => {
    const raw = cloneFixture() as { layers: unknown[] };
    const layer = {
      id: 99,
      name: 'ambient_sounds',
      type: 'objectgroup',
      draworder: 'topdown',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects: [
        {
          id: 900,
          name: 'hum',
          type: '',
          x: 100,
          y: 120,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          point: true,
          properties: [
            { name: 'sound', type: 'string', value: 'bottleHum' },
            { name: 'radius', type: 'float', value: 256 },
          ],
        },
      ],
    };
    raw.layers.push(layer);
    expect(loadMap(raw, 'test-map').ambientSounds).toEqual([
      { x: 100, y: 120, sound: 'bottleHum', radius: 256 },
    ]);
    (layer.objects[0] as { properties: unknown[] }).properties = [
      { name: 'radius', type: 'float', value: 0 },
    ];
    const issues = issuesOf(raw).join('\n');
    expect(issues).toMatch(/ambient_sounds #900: missing "sound" property/);
    expect(issues).toMatch(/ambient_sounds #900: needs a positive "radius" property/);
  });

  it('reads NPC spawn types from a property or the object class', () => {
    expect(map.npcSpawns).toEqual([
      { x: 144, y: 240, type: 'butcher', post: false },
      { x: 288, y: 200, type: 'security', post: false },
    ]);
  });

  it('reads the optional NPC spawn post flag and rejects a non-boolean one', () => {
    const raw = cloneFixture();
    const objects = layerOf(raw, 'npc_spawns').objects as { properties?: unknown[] }[];
    const guard = objects[1] as { properties?: unknown[] };
    guard.properties = [{ name: 'post', type: 'bool', value: true }];
    expect(loadMap(raw, 'test-map').npcSpawns[1]).toMatchObject({ type: 'security', post: true });
    guard.properties = [{ name: 'post', type: 'string', value: 'yes' }];
    expect(issuesOf(raw).join('\n')).toMatch(/npc_spawns #12: property "post" must be a boolean/);
  });

  it('reads the optional cart_spawns layer (P2-5) and has no carts without it', () => {
    expect(map.cartSpawns).toEqual([]);
    const raw = cloneFixture() as unknown as { layers: unknown[] };
    const point = (id: number, x: number, y: number, properties?: unknown[]): Record<string, unknown> => ({
      id,
      name: '',
      type: '',
      x,
      y,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
      ...(properties && { properties }),
    });
    raw.layers.push({
      id: 99,
      name: 'cart_spawns',
      type: 'objectgroup',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects: [
        point(901, c(2), c(2)),
        point(902, c(3), c(2), [{ name: 'dir', type: 'string', value: 'up' }]),
      ],
    });
    expect(loadMap(raw, 'test-map').cartSpawns).toEqual([
      { x: c(2), y: c(2), dir: 'left' },
      { x: c(3), y: c(2), dir: 'up' },
    ]);
    ((layerOf(raw, 'cart_spawns').objects ?? [])[1] as { properties: unknown[] }).properties = [
      { name: 'dir', type: 'string', value: 'sideways' },
    ];
    expect(issuesOf(raw).join('\n')).toMatch(/cart_spawns #902: dir must be down, up, left or right/);
  });

  it('reads NPC waypoints', () => {
    expect(map.npcWaypoints.map(({ name, x, y }) => ({ name, x, y }))).toEqual([
      { name: 'aisle_a', x: 240, y: 48 },
      { name: 'aisle_b', x: 336, y: 144 },
    ]);
  });

  it('reads forklift routes as absolute polylines', () => {
    expect(map.forkliftRoutes).toHaveLength(1);
    expect(map.forkliftRoutes[0]).toMatchObject({
      name: 'loop_a',
      points: [
        { x: 48, y: 144 },
        { x: 144, y: 144 },
        { x: 144, y: 80 },
      ],
    });
  });

  it('reads the office trigger polygon', () => {
    expect(map.officeTrigger.polygon).toEqual([
      { x: 256, y: 224 },
      { x: 320, y: 224 },
      { x: 288, y: 272 },
    ]);
    expect(inOfficeTrigger(map, 288, 240)).toBe(true);
    expect(inOfficeTrigger(map, 258, 270)).toBe(false);
  });
});

describe('loadMap: errors', () => {
  it.each([...TILE_LAYERS, ...OBJECT_LAYERS])('reports a missing "%s" layer', (name) => {
    const raw = cloneFixture();
    removeLayer(raw, name);
    expect(issuesOf(raw)).toContainEqual(expect.stringContaining(`"${name}"`));
  });

  it('lists every missing layer at once', () => {
    const raw = cloneFixture();
    removeLayer(raw, 'walls');
    removeLayer(raw, 'zones');
    expect(issuesOf(raw)).toEqual(['missing tile layer "walls"', 'missing object layer "zones"']);
  });

  it('names the source in the error message', () => {
    const raw = cloneFixture();
    removeLayer(raw, 'walls');
    expect(() => loadMap(raw, 'kespro.tmj')).toThrow(
      /Invalid map kespro\.tmj:\n {2}- missing tile layer "walls"/,
    );
  });

  it('rejects a layer of the wrong kind', () => {
    const raw = cloneFixture();
    const zones = layerOf(raw, 'zones');
    Object.assign(zones, { type: 'tilelayer', width: 12, height: 10, data: new Array(120).fill(0) });
    delete zones.objects;
    expect(issuesOf(raw)).toContain('layer "zones" must be an object layer');
  });

  it('rejects non-JSON-map input', () => {
    expect(issuesOf(null)[0]).toMatch(/^\(root\)/);
    expect(issuesOf({ ...cloneFixture(), orientation: 'isometric' })[0]).toMatch(/^orientation/);
  });

  it('explains base64 tile data', () => {
    const raw = cloneFixture();
    Object.assign(layerOf(raw, 'ground'), { encoding: 'base64', data: 'AAAA' });
    expect(issuesOf(raw)).toContainEqual(expect.stringContaining('CSV encoding'));
  });

  it('rejects layer offsets on tile, object and group layers', () => {
    const raw = cloneFixture();
    Object.assign(layerOf(raw, 'walls'), { offsetx: 4, offsety: 0 });
    Object.assign(layerOf(raw, 'zones'), { offsety: -8 });
    Object.assign(layerOf(raw, 'overlay'), { offsetx: 0.5 });
    expect(issuesOf(raw)).toEqual([
      'layers[1] ("walls"): layer offset 4,0 is not supported, move the contents instead (Layer > Offset must be 0,0)',
      'layers[2] ("overlay"): layer offset 0.5,0 is not supported, move the contents instead (Layer > Offset must be 0,0)',
      'layers[8] ("zones"): layer offset 0,-8 is not supported, move the contents instead (Layer > Offset must be 0,0)',
    ]);
  });

  it('rejects parallax, including on a layer inside a group', () => {
    const raw = cloneFixture();
    Object.assign(layerOf(raw, 'above'), { parallaxx: 1.2 });
    expect(issuesOf(raw)).toEqual([
      'layers[2].layers[1] ("above"): parallax factor 1.2,1 is not supported (must be 1,1)',
    ]);
  });

  it('accepts explicit default offset and parallax, and any on image layers', () => {
    const raw = cloneFixture();
    Object.assign(layerOf(raw, 'ground'), { offsetx: 0, offsety: 0, parallaxx: 1, parallaxy: 1 });
    raw.layers.push({ type: 'imagelayer', name: 'backdrop', offsetx: 20, parallaxx: 0.5 } as never);
    expect(() => loadMap(raw, 'test-map')).not.toThrow();
  });

  it('rejects a tile layer whose size does not match the map', () => {
    const raw = cloneFixture();
    Object.assign(layerOf(raw, 'walls'), { width: 11, data: new Array(110).fill(0) });
    expect(issuesOf(raw)).toContain('tile layer "walls" is 11x10, map is 12x10');
  });

  it('rejects duplicate zone ids and unknown spawn zones', () => {
    const raw = cloneFixture();
    const zones = layerOf(raw, 'zones').objects ?? [];
    Object.assign(zones[1] as object, {
      properties: [{ name: 'id', type: 'string', value: 'loading_dock' }],
    });
    expect(issuesOf(raw)).toEqual([
      'zones: duplicate zone id "loading_dock"',
      'item_spawns #8: zone "cold_room" is not in the zones layer',
    ]);
  });

  it('rejects bad zone properties', () => {
    const raw = cloneFixture();
    const zones = layerOf(raw, 'zones').objects ?? [];
    Object.assign(zones[1] as object, {
      properties: [
        { name: 'id', type: 'string', value: 'cold_room' },
        { name: 'friction', type: 'float', value: 1.5 },
        { name: 'speedMultiplier', type: 'string', value: 'fast' },
        { name: 'wantedOnEnter', type: 'string', value: 'yes' },
      ],
    });
    expect(issuesOf(raw)).toEqual([
      'zones #101: property "speedMultiplier" must be a number',
      'zones #101: property "wantedOnEnter" must be a boolean',
      'zones #101: friction must be between 0 and 1, got 1.5',
    ]);
  });

  it('reads damagePerSecond on a zone and rejects a non-positive one (P2-2)', () => {
    const raw = cloneFixture();
    const zones = layerOf(raw, 'zones').objects ?? [];
    Object.assign(zones[1] as object, {
      properties: [
        { name: 'id', type: 'string', value: 'cold_room' },
        { name: 'damagePerSecond', type: 'float', value: 8 },
      ],
    });
    const map = loadMap(raw, 'test-map');
    expect(map.zones.find((z) => z.id === 'cold_room')?.damagePerSecond).toBe(8);
    expect(map.zones.some((z) => z.id !== 'cold_room' && 'damagePerSecond' in z)).toBe(false);
    Object.assign(zones[1] as object, {
      properties: [
        { name: 'id', type: 'string', value: 'cold_room' },
        { name: 'damagePerSecond', type: 'float', value: 0 },
      ],
    });
    expect(issuesOf(raw)).toEqual(['zones #101: damagePerSecond must be positive, got 0']);
  });

  it('rejects van slots without an index or with a duplicate index', () => {
    const raw = cloneFixture();
    const slots = layerOf(raw, 'van_slots').objects ?? [];
    Object.assign(slots[0] as object, { properties: [{ name: 'index', type: 'int', value: 0 }] });
    slots.push({ id: 150, x: 1, y: 1, point: true });
    expect(issuesOf(raw)).toEqual([
      'van_slots #150: property "index" must be a non-negative integer',
      'van_slots: duplicate index 0',
    ]);
  });

  it('reads team van slots, defaulting to the first two (P1 review F3)', () => {
    expect(loadMap(cloneFixture()).teamVanSlots).toEqual([0, 1]);
    const raw = cloneFixture();
    const slots = layerOf(raw, 'van_slots').objects ?? [];
    const addTeam = (i: number, team: number) => {
      const slot = slots[i];
      if (!slot) throw new Error(`fixture has no van slot ${i}`);
      slot['properties'] = [
        ...((slot['properties'] as object[] | undefined) ?? []),
        { name: 'team', type: 'int', value: team },
      ];
    };
    // Fixture objects: #6 is index 1 (position 1), #7 index 0 (position 0).
    addTeam(0, 1);
    addTeam(1, 2);
    const map = loadMap(raw);
    expect(map.teamVanSlots).toEqual([1, 0]);
    expect(map.vanSlots[1]?.team).toBe(1);
  });

  it('rejects team van slots that name one team only, a team twice or another team', () => {
    const raw = cloneFixture();
    const slots = layerOf(raw, 'van_slots').objects ?? [];
    const addTeam = (i: number, team: number) => {
      const slot = slots[i];
      if (!slot) throw new Error(`fixture has no van slot ${i}`);
      slot['properties'] = [
        ...((slot['properties'] as object[] | undefined) ?? []),
        { name: 'team', type: 'int', value: team },
      ];
    };
    addTeam(0, 1);
    expect(issuesOf(raw)).toEqual([
      'van_slots: name a slot for both teams (team 1 and team 2) or for neither',
    ]);
    addTeam(1, 1);
    expect(issuesOf(raw)).toEqual([
      'van_slots: team 1 is on 2 slots, expected 1',
      'van_slots: name a slot for both teams (team 1 and team 2) or for neither',
    ]);
    const other = cloneFixture();
    const otherSlot = (layerOf(other, 'van_slots').objects ?? [])[0];
    if (!otherSlot) throw new Error('fixture has no van slot');
    otherSlot['properties'] = [
      ...((otherSlot['properties'] as object[] | undefined) ?? []),
      { name: 'team', type: 'int', value: 3 },
    ];
    expect(issuesOf(other)).toEqual([`van_slots #${String(otherSlot['id'])}: team must be 1 or 2, got 3`]);
  });

  it('rejects wrong object shapes', () => {
    const raw = cloneFixture();
    (layerOf(raw, 'item_spawns').objects ?? []).push({ id: 151, x: 0, y: 0, width: 32, height: 32 });
    (layerOf(raw, 'forklift_routes').objects ?? []).push({ id: 152, x: 0, y: 0, polyline: [{ x: 0, y: 0 }] });
    expect(issuesOf(raw)).toEqual([
      'item_spawns #151: must be a point object',
      'item_spawns #151: missing "zone" property',
      'forklift_routes #152: must be a polyline with at least 2 points',
    ]);
  });

  it('requires exactly one office trigger', () => {
    const raw = cloneFixture();
    layerOf(raw, 'office_trigger').objects = [];
    expect(issuesOf(raw)).toEqual(['office_trigger: expected exactly 1 object, found 0']);
  });

  it('rejects rotated areas', () => {
    const raw = cloneFixture();
    Object.assign((layerOf(raw, 'zones').objects ?? [])[0] as object, { rotation: 45 });
    expect(issuesOf(raw)).toEqual(['zones #100: rotated objects are not supported']);
  });
});

describe('MapModel and the movement rules', () => {
  it('plugs straight into step() and moveAabb() without an adapter', () => {
    const movementMap: MovementMap = map;
    const grid: CollisionGrid = map.collision;
    expect(movementMap.zoneAt(c(8), c(2))?.friction).toBe(0.92);
    expect(grid.isSolid(0, 0)).toBe(true);
  });
});

describe('loadMap: gates (phase 2 decision 9)', () => {
  type Obj = Record<string, unknown>;
  const gateObject = (id: number, props: Obj[], shape: Obj = {}): Obj => ({
    id,
    name: '',
    type: '',
    rotation: 0,
    visible: true,
    x: 64,
    y: 96,
    width: 32,
    height: 64,
    properties: props,
    ...shape,
  });
  const withGates = (objects: Obj[]): unknown => {
    const raw = cloneFixture() as { layers: unknown[] };
    raw.layers.push({
      id: 99,
      name: 'gates',
      type: 'objectgroup',
      draworder: 'topdown',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects,
    });
    return raw;
  };
  const dir = (value: string): Obj => ({ name: 'dir', type: 'string', value });
  const kind = (value: string): Obj => ({ name: 'kind', type: 'string', value });

  it('is optional: a map without the layer has no gates', () => {
    expect(map.gates).toEqual([]);
  });

  it('reads rectangles with a direction and a kind (checkout by default), indexed in layer order', () => {
    const loaded = loadMap(withGates([gateObject(50, [dir('s')]), gateObject(51, [dir('n'), kind('door')])]));
    expect(loaded.gates).toEqual([
      { index: 0, x: 64, y: 96, width: 32, height: 64, dir: 's', kind: 'checkout' },
      { index: 1, x: 64, y: 96, width: 32, height: 64, dir: 'n', kind: 'door' },
    ]);
  });

  it('lists every bad gate', () => {
    const issues = issuesOf(
      withGates([
        gateObject(50, []),
        gateObject(51, [dir('up')]),
        gateObject(52, [dir('e'), kind('turnstile')]),
        gateObject(53, [dir('e')], { width: 0, height: 0, point: true }),
      ]),
    );
    expect(issues).toEqual([
      'gates #50: property "dir" must be one of n, e, s, w',
      'gates #51: property "dir" must be one of n, e, s, w',
      'gates #52: property "kind" must be one of checkout, door',
      'gates #53: must be a rectangle',
    ]);
  });
});
