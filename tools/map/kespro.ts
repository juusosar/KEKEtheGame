// The kespro blockout map (§9.1, §15.4), built from code so the layout stays reviewable and
// reproducible. `npm run gen:map` writes maps/kespro.tmj; tools/gen-kespro-map.test.ts checks it.
//
// Layout (tile coordinates, 96 × 64; it was 120 × 80 until Juhi asked for a tighter map, 2026-11-11):
//   x 0–9     loading dock: 16 van slots in two columns around the middle of the west edge, dock
//             gates into the store
//   x 10–69   the store (walled). Staff-only room in the north-west corner is the shortcut from
//             the dock to the back of the store. Dry goods (rack aisles) north, beverage pallets
//             south-west, cold room (walled, curtain doors) in the middle, freezer aisles and the
//             meat & fish counter south, entrance + checkout lanes along the east side.
//   x 70–80   parking lot with parked cars
//   x 81–85   the street
//   x 87–95   the office building with the race-mode office trigger
// Tree lines along the top and bottom edges stop players walking around the store, so the dock
// and the office are only connected through the store (or the staff-only shortcut).
import { TILE, TILES, tileIndex, type TileName } from '../art/tiles';

export const MAP_WIDTH = 96;
export const MAP_HEIGHT = 64;

/** Inclusive tile rectangle. */
type Rect = readonly [x0: number, y0: number, x1: number, y1: number];
type TilePoint = readonly [tx: number, ty: number];

/** Values the map copies from the game config (§6), so tuning stays in config.json. */
export interface MapConfigInput {
  coldRoomFriction: number;
  coldRoomSpeedMultiplier: number;
}

class TileLayer {
  readonly data: number[] = new Array<number>(MAP_WIDTH * MAP_HEIGHT).fill(0);

  set(x: number, y: number, name: TileName | null): this {
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) throw new Error(`tile ${x},${y} off map`);
    this.data[y * MAP_WIDTH + x] = name === null ? 0 : tileIndex(name) + 1;
    return this;
  }

  fill([x0, y0, x1, y1]: Rect, name: TileName | null): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, name);
    return this;
  }

  /** The four edges of a rectangle. */
  outline([x0, y0, x1, y1]: Rect, name: TileName): this {
    return this.fill([x0, y0, x1, y0], name)
      .fill([x0, y1, x1, y1], name)
      .fill([x0, y0, x0, y1], name)
      .fill([x1, y0, x1, y1], name);
  }
}

// ── Areas ──────────────────────────────────────────────────────────────────────────────────────

const STORE: Rect = [10, 3, 69, 60];
const STAFF_ROOM: Rect = [10, 3, 21, 12]; // walls included
const COLD_ROOM: Rect = [36, 23, 60, 40]; // walls included
const OFFICE_BUILDING: Rect = [88, 24, 94, 39]; // walls included
const STREET_X: readonly [number, number] = [81, 85];

/** Dock gates in the store's west wall (rows), facing the vans in the middle of the dock. */
const DOCK_GATES: readonly (readonly [number, number])[] = [
  [19, 22],
  [29, 34],
  [41, 44],
];
const STAFF_DOCK_DOOR: readonly [number, number] = [6, 7]; // rows in x = 10
const STAFF_STORE_DOOR: readonly [number, number] = [8, 9]; // rows in x = 21
const ENTRANCE_DOOR: readonly [number, number] = [28, 35]; // rows in x = 69
const OFFICE_DOOR: readonly [number, number] = [30, 33]; // rows in x = 88

/** Cold-room curtain doorways: wall tiles that become openings with a curtain overhead. */
const CURTAIN_DOORS: readonly Rect[] = [
  [47, 23, 49, 23], // north, from dry goods
  [36, 30, 36, 32], // west, from beverages
  [42, 40, 44, 40], // south, to the freezer aisles
  [60, 33, 60, 34], // east, to the entrance
];

/** Dry-goods pallet racks: double rows with cross aisles at x 22–24, 39–41 and 57–60. */
const RACK_ROWS = [7, 12, 17];
const RACK_SPANS: readonly (readonly [number, number])[] = [
  [25, 38],
  [42, 56],
];

/** Beverage hall pallet stacks (2 × 2), top-left tiles; a few left out for open lanes. */
const PALLET_XS = [14, 20, 26, 32];
const PALLET_YS = [26, 32, 38, 44, 50, 56];
const PALLET_GAPS = new Set(['14,44', '20,44', '26,32', '20,50']);

/** Cold-room fridge rows: [y, x0, x1]. */
const FRIDGE_ROWS: readonly (readonly [number, number, number])[] = [
  [24, 38, 46],
  [24, 51, 58],
  [28, 39, 46],
  [28, 51, 58],
  [35, 39, 46],
  [35, 51, 58],
];

/** Freezer cabinet columns (2 wide), rows 43–49 and 52–57 with a cross gap at 50–51. */
const FREEZER_XS = [38, 42, 46];

/** Meat & fish: counter row with an opening at its east end; behind it is the butcher's area. */
const COUNTER_ROW = 46;
const COUNTER_X: readonly [number, number] = [49, 57];

/** Checkout line at x = 64 between these rows; lanes are the gaps. */
const CHECKOUT_X = 64;
const CHECKOUT_LANES = new Set([18, 19, 24, 25, 30, 31, 32, 33, 38, 39, 44, 45]);

/** Parked cars (1 × 2), top tiles. */
const CARS: readonly TilePoint[] = [
  [73, 6],
  [73, 10],
  [73, 18],
  [73, 40],
  [73, 48],
  [73, 54],
  [77, 8],
  [77, 14],
  [77, 22],
  [77, 44],
  [77, 52],
  [77, 57],
];
const PARKING_LINE_XS = [72, 76];

// ── Objects ────────────────────────────────────────────────────────────────────────────────────

/**
 * Van slot centres in tiles (vans are 2 × 3 tiles): two columns of eight around the middle of the
 * west edge (Juhi, 2026-11-11: the vans start in the middle of the map on the left side). Slots fill
 * from the middle outwards, east column (nearer the store) first in each pair of rows, so a small
 * room parks in the middle of the dock.
 */
const VAN_COLUMNS = [7, 3];
const VAN_ROW_ORDER: readonly number[] = [29.5, 33.5, 25.5, 37.5, 21.5, 41.5, 17.5, 45.5];
export const VAN_SLOT_TILES: readonly TilePoint[] = [];
for (let pair = 0; pair < VAN_ROW_ORDER.length; pair += 2) {
  for (const x of VAN_COLUMNS) {
    for (const y of VAN_ROW_ORDER.slice(pair, pair + 2)) (VAN_SLOT_TILES as TilePoint[]).push([x, y]);
  }
}
/**
 * Van slot `index` of team 1's and team 2's van with Teams on (P1 review F3). Slots 1 and 2 are 4
 * tiles apart in the middle of the dock, so Teams rounds use slots 5 and 6: the same east column,
 * 12 tiles apart, either side of the middle dock gate (tools/kespro-race.test.ts checks the walks).
 */
export const TEAM_VAN_SLOTS: readonly [number, number] = [5, 6];

/** Item spawn tiles per item zone. Positions are tile centres. */
export const ITEM_SPAWN_TILES: Readonly<Record<string, readonly TilePoint[]>> = {
  dry_goods: [
    [17, 17],
    [30, 5],
    [48, 5],
    [28, 10],
    [36, 10],
    [47, 10],
    [55, 10],
    [33, 15],
    [50, 15],
    [30, 20],
    [45, 20],
    [56, 20],
    [38, 22],
  ],
  beverages: [
    [17, 24],
    [30, 24],
    [23, 29],
    [18, 36],
    [29, 41],
    [24, 47],
    [16, 53],
    [30, 53],
    [23, 58],
    [35, 58],
  ],
  cold_room: [
    [38, 26],
    [44, 26],
    [55, 26],
    [59, 30],
    [42, 31],
    [49, 32],
    [56, 32],
    [38, 38],
    [48, 38],
    [57, 37],
  ],
  frozen: [
    [40, 42],
    [48, 44],
    [41, 46],
    [45, 48],
    [44, 51],
    [40, 56],
    [48, 57],
    [45, 58],
  ],
  // The first three sit behind the counter, inside the butcher's behind_counter zone (risk!).
  meat_fish: [
    [52, 42],
    [56, 43],
    [59, 41],
    [51, 49],
    [56, 48],
    [60, 50],
    [59, 56],
    [52, 57],
  ],
};

/**
 * Item spawns marked `oddSpot: true` (§10.1, phase 2 decision 11): joke items appear here first when
 * one is free. Each must be a tile in ITEM_SPAWN_TILES (the spawns themselves do not move).
 */
export const ODD_SPOT_TILES: readonly TilePoint[] = [
  [56, 20], // the far end of a dry-goods rack aisle
  [59, 41], // behind the butcher's counter, in the corner
  [35, 58], // behind the last beverage pallet stacks
];

/** [type, x, y, post]: `post` makes the NPC stand guard there instead of patrolling (§8). */
const NPC_SPAWN_TILES: readonly (readonly [string, number, number, boolean?])[] = [
  ['security', 23, 8, true], // post at the staff-only door
  ['security', 66, 32], // entrance
  ['security', 59, 21],
  ['stocker', 32, 10],
  ['stocker', 48, 15],
  ['stocker', 17, 35],
  ['stocker', 35, 47],
  ['butcher', 54, 43],
];

const NPC_WAYPOINT_TILES: readonly TilePoint[] = [
  [23, 5],
  [40, 5],
  [58, 5],
  [23, 15],
  [40, 15],
  [58, 15],
  [23, 21],
  [40, 21],
  [58, 21],
  [12, 25],
  [34, 29],
  [17, 42],
  [35, 55],
  [12, 58],
  [41, 50],
  [48, 50],
];

/** Forklift loops (tile centres); the forklift drives back from the last point to the first. */
const FORKLIFT_ROUTES: readonly (readonly [string, readonly TilePoint[]])[] = [
  [
    'dry_goods_loop',
    [
      [40, 5],
      [40, 21],
      [58, 21],
      [58, 5],
    ],
  ],
  [
    'beverages_loop',
    [
      [17, 29],
      [30, 29],
      [30, 54],
      [17, 54],
    ],
  ],
];

interface ZoneSpec {
  id: string;
  name: string;
  /** Polygon in tile-edge coordinates. */
  polygon: readonly TilePoint[];
  friction?: number;
  speedMultiplier?: number;
  wantedOnEnter?: boolean;
}

const rectPolygon = ([x0, y0, x1, y1]: Rect): TilePoint[] => [
  [x0, y0],
  [x1 + 1, y0],
  [x1 + 1, y1 + 1],
  [x0, y1 + 1],
];

function zoneSpecs(config: MapConfigInput): ZoneSpec[] {
  return [
    { id: 'loading_dock', name: 'Loading dock', polygon: rectPolygon([0, 3, 9, 60]) },
    { id: 'entrance', name: 'Entrance & checkout', polygon: rectPolygon([61, 4, 68, 59]) },
    {
      id: 'dry_goods',
      name: 'Dry goods',
      // Wraps around the staff-only room in the north-west corner.
      polygon: [
        [22, 4],
        [61, 4],
        [61, 23],
        [11, 23],
        [11, 13],
        [22, 13],
      ],
    },
    { id: 'beverages', name: 'Beverage pallets', polygon: rectPolygon([11, 23, 36, 59]) },
    {
      id: 'cold_room',
      name: 'Cold & dairy room',
      polygon: rectPolygon([37, 24, 59, 39]),
      friction: config.coldRoomFriction,
      speedMultiplier: config.coldRoomSpeedMultiplier,
    },
    { id: 'frozen', name: 'Freezer aisle', polygon: rectPolygon([37, 41, 48, 59]) },
    { id: 'meat_fish', name: 'Meat & fish counter', polygon: rectPolygon([49, 41, 60, 59]) },
    { id: 'behind_counter', name: 'Behind the counter', polygon: rectPolygon([50, 41, 60, 45]) },
    {
      id: 'staff_only',
      name: 'Staff-only back room',
      polygon: rectPolygon([11, 4, 20, 11]),
      wantedOnEnter: true,
    },
    { id: 'parking', name: 'Parking lot', polygon: rectPolygon([70, 3, 80, 60]) },
    { id: 'office', name: 'Office', polygon: rectPolygon([87, 22, 95, 41]) },
  ];
}

// ── Tile layers ────────────────────────────────────────────────────────────────────────────────

interface TileLayers {
  ground: TileLayer;
  walls: TileLayer;
  decor: TileLayer;
  above: TileLayer;
}

function paintTiles(): TileLayers {
  const ground = new TileLayer();
  const walls = new TileLayer();
  const decor = new TileLayer();
  const above = new TileLayer();

  // Outside: grass, the dock yard, parking lot, street and sidewalks.
  ground.fill([0, 0, MAP_WIDTH - 1, MAP_HEIGHT - 1], 'grass');
  ground.fill([0, 3, 7, 60], 'asphalt').fill([8, 3, 9, 60], 'dock');
  ground.fill([70, 3, 79, 60], 'asphalt');
  for (const x of PARKING_LINE_XS) ground.fill([x, 3, x, 60], 'parking_line');
  ground.fill([80, 0, 80, MAP_HEIGHT - 1], 'sidewalk').fill([86, 0, 86, MAP_HEIGHT - 1], 'sidewalk');
  ground.fill([STREET_X[0], 0, STREET_X[1], MAP_HEIGHT - 1], 'road');
  for (let y = 0; y < MAP_HEIGHT; y += 2) ground.set(83, y, 'road_line');

  // Tree lines along the top and bottom edges, west of the street.
  for (const y of [0, 1, 2, 61, 62, 63]) walls.fill([0, y, STREET_X[0] - 2, y], 'tree');
  for (const y of [0, 1, 2, 61, 62, 63]) ground.fill([0, y, STREET_X[0] - 2, y], 'grass');

  // Store shell and floors.
  ground.fill([STORE[0] + 1, STORE[1] + 1, STORE[2] - 1, STORE[3] - 1], 'floor');
  ground.fill([11, 23, 35, 59], 'floor_alt');
  walls.outline(STORE, 'wall');
  for (const x of [20, 35, 50, 65]) walls.set(x, STORE[1], 'wall_window').set(x, STORE[3], 'wall_window');
  for (const [y0, y1] of DOCK_GATES) {
    walls.fill([STORE[0], y0, STORE[0], y1], null);
    ground.fill([STORE[0], y0, STORE[0], y1], 'dock');
    decor.fill([STORE[0] - 1, y0, STORE[0] - 1, y1], 'hazard');
  }
  walls.fill([STORE[2], ENTRANCE_DOOR[0], STORE[2], ENTRANCE_DOOR[1]], null);
  ground.fill([STORE[2], ENTRANCE_DOOR[0], STORE[2], ENTRANCE_DOOR[1]], 'door');
  ground.fill([66, ENTRANCE_DOOR[0], 68, ENTRANCE_DOOR[1]], 'entrance_mat');
  above.set(STORE[2], ENTRANCE_DOOR[0] - 1, 'sign').set(STORE[2], ENTRANCE_DOOR[1] + 1, 'sign');

  // Staff-only room: the shortcut from the dock to the back of the store.
  ground.fill([11, 4, 20, 11], 'floor_staff');
  walls.fill([STAFF_ROOM[0], STAFF_ROOM[3], STAFF_ROOM[2], STAFF_ROOM[3]], 'wall');
  walls.fill([STAFF_ROOM[2], STAFF_ROOM[1], STAFF_ROOM[2], STAFF_ROOM[3]], 'wall');
  walls.fill([STORE[0], STAFF_DOCK_DOOR[0], STORE[0], STAFF_DOCK_DOOR[1]], null);
  ground.fill([STORE[0], STAFF_DOCK_DOOR[0], STORE[0], STAFF_DOCK_DOOR[1]], 'staff_door');
  walls.fill([STAFF_ROOM[2], STAFF_STORE_DOOR[0], STAFF_ROOM[2], STAFF_STORE_DOOR[1]], null);
  ground.fill([STAFF_ROOM[2], STAFF_STORE_DOOR[0], STAFF_ROOM[2], STAFF_STORE_DOOR[1]], 'staff_door');
  walls.set(13, 5, 'crate').set(14, 5, 'crate').set(19, 10, 'crate');
  above.set(STAFF_ROOM[2], STAFF_STORE_DOOR[0] - 1, 'sign');

  // Dry goods: long pallet-rack aisles. Rack tops overhang the aisle north of each row.
  for (const y of RACK_ROWS) {
    for (const [x0, x1] of RACK_SPANS) {
      walls.fill([x0, y, x1, y + 1], 'rack');
      above.fill([x0, y - 1, x1, y - 1], 'rack_top');
    }
  }

  // Beverage hall: stacked pallets as cover.
  for (const x of PALLET_XS) {
    for (const y of PALLET_YS) {
      if (!PALLET_GAPS.has(`${x},${y}`)) walls.fill([x, y, x + 1, y + 1], 'pallet_stack');
    }
  }

  // Cold room: walled, slippery floor, plastic strip curtains in the doorways.
  ground.fill([COLD_ROOM[0] + 1, COLD_ROOM[1] + 1, COLD_ROOM[2] - 1, COLD_ROOM[3] - 1], 'floor_cold');
  walls.outline(COLD_ROOM, 'wall');
  for (const door of CURTAIN_DOORS) {
    walls.fill(door, null);
    ground.fill(door, 'floor_cold');
    above.fill(door, 'curtain');
  }
  for (const [y, x0, x1] of FRIDGE_ROWS) walls.fill([x0, y, x1, y], 'fridge');

  // Freezer aisles.
  for (const x of FREEZER_XS) {
    walls.fill([x, 43, x + 1, 49], 'freezer').fill([x, 52, x + 1, 57], 'freezer');
  }

  // Meat & fish counter; the butcher works behind it.
  walls.fill([COUNTER_X[0], COUNTER_ROW, COUNTER_X[1], COUNTER_ROW], 'counter');
  walls.fill([COUNTER_X[0], 41, COUNTER_X[0], COUNTER_ROW], 'counter');
  ground.fill([50, 41, 60, 45], 'floor_alt');
  walls.fill([52, 52, 58, 52], 'fridge');
  decor.fill([58, COUNTER_ROW, 60, COUNTER_ROW], 'hazard');

  // Entrance: checkout line with lanes, trolley rows at both ends.
  for (let y = STORE[1] + 1; y < STORE[3]; y++) {
    if (CHECKOUT_LANES.has(y)) continue;
    walls.set(CHECKOUT_X, y, y < 14 || y > 48 ? 'trolley' : 'checkout');
  }
  walls.fill([66, 6, 67, 12], 'trolley').fill([66, 51, 67, 57], 'trolley');

  // Forklift route corners get hazard markings on the floor.
  for (const [, points] of FORKLIFT_ROUTES) for (const [x, y] of points) decor.set(x, y, 'hazard');

  // Parking lot cars.
  for (const [x, y] of CARS) walls.fill([x, y, x, y + 1], 'car');

  // The office across the street.
  ground.fill(
    [OFFICE_BUILDING[0] + 1, OFFICE_BUILDING[1] + 1, OFFICE_BUILDING[2] - 1, OFFICE_BUILDING[3] - 1],
    'floor_office',
  );
  walls.outline(OFFICE_BUILDING, 'wall');
  walls.fill([OFFICE_BUILDING[0], OFFICE_DOOR[0], OFFICE_BUILDING[0], OFFICE_DOOR[1]], null);
  ground.fill([OFFICE_BUILDING[0], OFFICE_DOOR[0], OFFICE_BUILDING[0], OFFICE_DOOR[1]], 'door');
  ground.fill([87, OFFICE_DOOR[0], 87, OFFICE_DOOR[1]], 'sidewalk');
  walls
    .set(91, 27, 'office_desk')
    .set(92, 27, 'office_desk')
    .set(91, 36, 'office_desk')
    .set(92, 36, 'office_desk');
  walls.set(OFFICE_BUILDING[0], 27, 'wall_window').set(OFFICE_BUILDING[0], 36, 'wall_window');
  above.set(OFFICE_BUILDING[0], OFFICE_DOOR[0] - 1, 'sign');
  for (const [x, y] of [
    [90, 6],
    [93, 14],
    [89, 19],
    [92, 46],
    [89, 52],
    [94, 57],
  ] as const) {
    walls.set(x, y, 'tree');
  }

  return { ground, walls, decor, above };
}

// ── Tiled JSON ─────────────────────────────────────────────────────────────────────────────────

type Property = { name: string; type: 'string' | 'int' | 'float' | 'bool'; value: string | number | boolean };

const px = (tiles: number): number => tiles * TILE;
const centre = (tile: number): number => (tile + 0.5) * TILE;

/** Builds the map as Tiled JSON. `tileset` is the parsed maps/kespro_tiles.tsj, embedded so
 *  engines that cannot load external tilesets (Phaser) can read the map directly. */
export function buildKesproMap(
  config: MapConfigInput,
  tileset: Record<string, unknown>,
): Record<string, unknown> {
  let nextObjectId = 1;
  const object = (fields: Record<string, unknown>, properties: Property[] = []): Record<string, unknown> => ({
    id: nextObjectId++,
    name: '',
    type: '',
    rotation: 0,
    visible: true,
    ...fields,
    ...(properties.length > 0 && { properties }),
  });
  const point = (x: number, y: number, name: string, properties: Property[]): Record<string, unknown> =>
    object({ name, x, y, width: 0, height: 0, point: true }, properties);

  const tiles = paintTiles();
  const tileLayer = (id: number, name: keyof TileLayers): Record<string, unknown> => ({
    id,
    name,
    type: 'tilelayer',
    x: 0,
    y: 0,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    opacity: 1,
    visible: true,
    data: tiles[name].data,
  });
  const objectLayer = (
    id: number,
    name: string,
    objects: Record<string, unknown>[],
  ): Record<string, unknown> => ({
    id,
    name,
    type: 'objectgroup',
    draworder: 'topdown',
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    objects,
  });

  const zones = zoneSpecs(config).map((z) => {
    const [ox, oy] = z.polygon[0] as TilePoint;
    const properties: Property[] = [{ name: 'id', type: 'string', value: z.id }];
    if (z.friction !== undefined) properties.push({ name: 'friction', type: 'float', value: z.friction });
    if (z.speedMultiplier !== undefined) {
      properties.push({ name: 'speedMultiplier', type: 'float', value: z.speedMultiplier });
    }
    if (z.wantedOnEnter) properties.push({ name: 'wantedOnEnter', type: 'bool', value: true });
    return object(
      {
        name: z.name,
        x: px(ox),
        y: px(oy),
        width: 0,
        height: 0,
        polygon: z.polygon.map(([x, y]) => ({ x: px(x - ox), y: px(y - oy) })),
      },
      properties,
    );
  });

  const vanSlots = VAN_SLOT_TILES.map(([x, y], i) => {
    const team = TEAM_VAN_SLOTS.indexOf(i + 1) + 1;
    return point(px(x), px(y), `van_${i + 1}`, [
      { name: 'index', type: 'int', value: i + 1 },
      ...(team > 0 ? [{ name: 'team', type: 'int', value: team } satisfies Property] : []),
    ]);
  });

  const isOddSpot = (x: number, y: number): boolean =>
    ODD_SPOT_TILES.some(([ox, oy]) => ox === x && oy === y);
  const itemSpawns = Object.entries(ITEM_SPAWN_TILES).flatMap(([zone, spots]) =>
    spots.map(([x, y]) =>
      point(centre(x), centre(y), '', [
        { name: 'zone', type: 'string', value: zone },
        ...(isOddSpot(x, y) ? [{ name: 'oddSpot', type: 'bool', value: true } satisfies Property] : []),
      ]),
    ),
  );

  const npcSpawns = NPC_SPAWN_TILES.map(([type, x, y, post]) =>
    point(centre(x), centre(y), type, [
      { name: 'type', type: 'string', value: type },
      ...(post === true ? [{ name: 'post', type: 'bool', value: true } satisfies Property] : []),
    ]),
  );

  const waypoints = NPC_WAYPOINT_TILES.map(([x, y], i) => point(centre(x), centre(y), `wp_${i + 1}`, []));

  const forkliftRoutes = FORKLIFT_ROUTES.map(([name, points]) => {
    const [ox, oy] = points[0] as TilePoint;
    return object({
      name,
      x: centre(ox),
      y: centre(oy),
      width: 0,
      height: 0,
      polyline: points.map(([x, y]) => ({ x: px(x - ox), y: px(y - oy) })),
    });
  });

  const triggerArea: Rect = [
    OFFICE_BUILDING[0] + 1,
    OFFICE_BUILDING[1] + 1,
    OFFICE_BUILDING[2] - 1,
    OFFICE_BUILDING[3] - 1,
  ];
  const officeTrigger = object({
    name: 'office_trigger',
    x: px(triggerArea[0]),
    y: px(triggerArea[1]),
    width: px(triggerArea[2] - triggerArea[0] + 1),
    height: px(triggerArea[3] - triggerArea[1] + 1),
  });

  const layers = [
    tileLayer(1, 'ground'),
    tileLayer(2, 'walls'),
    tileLayer(3, 'decor'),
    objectLayer(4, 'zones', zones),
    objectLayer(5, 'van_slots', vanSlots),
    objectLayer(6, 'item_spawns', itemSpawns),
    objectLayer(7, 'npc_spawns', npcSpawns),
    objectLayer(8, 'npc_waypoints', waypoints),
    objectLayer(9, 'forklift_routes', forkliftRoutes),
    objectLayer(10, 'office_trigger', [officeTrigger]),
    tileLayer(11, 'above'),
  ];

  const { type: _type, version: _version, ...embedded } = tileset;
  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    compressionlevel: -1,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: layers.length + 1,
    nextobjectid: nextObjectId,
    layers,
    tilesets: [{ firstgid: 1, ...embedded }],
  };
}

/** JSON text with tile data written one map row per line (like Tiled's CSV format), so diffs stay readable. */
export function serializeMap(map: Record<string, unknown>): string {
  const width = typeof map['width'] === 'number' ? map['width'] : MAP_WIDTH;
  const rows = new Map<string, string>();
  const json = JSON.stringify(
    map,
    (key, value: unknown) => {
      if (key === 'data' && Array.isArray(value)) {
        const token = `__tile_data_${rows.size}__`;
        const lines: string[] = [];
        for (let i = 0; i < value.length; i += width) lines.push(value.slice(i, i + width).join(','));
        rows.set(token, lines.join(',\n'));
        return token;
      }
      return value;
    },
    2,
  );
  return `${json.replace(/"(__tile_data_\d+__)"/g, (_, token: string) => `[\n${rows.get(token) ?? ''}\n]`)}\n`;
}

/** Names of tiles the walls layer may contain (solid) and the above layer may contain. */
export const SOLID_TILES = new Set<string>(TILES.filter((t) => t.solid).map((t) => t.name));
export const ABOVE_TILES = new Set<string>(TILES.filter((t) => 'above' in t && t.above).map((t) => t.name));
