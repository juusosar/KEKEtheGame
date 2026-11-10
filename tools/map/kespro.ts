// The kespro blockout map (§9.1, §15.4), built from code so the layout stays reviewable and
// reproducible. `npm run gen:map` writes maps/kespro.tmj; tools/gen-kespro-map.test.ts checks it.
//
// Layout (tile coordinates, 120 × 80):
//   x 0–14    loading dock: 16 van slots in two columns, dock gates into the store
//   x 15–89   the store (walled). Staff-only room in the north-west corner is the shortcut from
//             the dock to the back of the store. Dry goods (rack aisles) north, beverage pallets
//             south-west, cold room (walled, curtain doors) in the middle, freezer aisles and the
//             meat & fish counter south, entrance + checkout lanes along the east side.
//   x 90–104  parking lot with parked cars
//   x 105–109 the street
//   x 110–119 the office building with the race-mode office trigger
// Tree lines along the top and bottom edges stop players walking around the store, so the dock
// and the office are only connected through the store (or the staff-only shortcut).
import { TILE, TILES, tileIndex, type TileName } from '../art/tiles';

export const MAP_WIDTH = 120;
export const MAP_HEIGHT = 80;

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

const STORE: Rect = [15, 3, 89, 76];
const STAFF_ROOM: Rect = [15, 3, 28, 14]; // walls included
const COLD_ROOM: Rect = [46, 31, 76, 53]; // walls included
const OFFICE_BUILDING: Rect = [112, 32, 118, 47]; // walls included
const STREET_X: readonly [number, number] = [105, 109];

/** Dock gates in the store's west wall (rows). */
const DOCK_GATES: readonly (readonly [number, number])[] = [
  [22, 25],
  [36, 43],
  [50, 55],
];
const STAFF_DOCK_DOOR: readonly [number, number] = [7, 8]; // rows in x = 15
const STAFF_STORE_DOOR: readonly [number, number] = [9, 10]; // rows in x = 28
const ENTRANCE_DOOR: readonly [number, number] = [36, 43]; // rows in x = 89
const OFFICE_DOOR: readonly [number, number] = [38, 41]; // rows in x = 112

/** Cold-room curtain doorways: wall tiles that become openings with a curtain overhead. */
const CURTAIN_DOORS: readonly Rect[] = [
  [58, 31, 60, 31], // north, from dry goods
  [46, 40, 46, 42], // west, from beverages
  [52, 53, 54, 53], // south, to the freezer aisles
  [76, 44, 76, 45], // east, to the entrance
];

/** Dry-goods pallet racks: double rows with cross aisles at x 29–30, 49–52 and 73–76. */
const RACK_ROWS = [7, 12, 17, 22];
const RACK_SPANS: readonly (readonly [number, number])[] = [
  [31, 48],
  [53, 72],
];

/** Beverage hall pallet stacks (2 × 2), top-left tiles; a few left out for open lanes. */
const PALLET_XS = [21, 27, 33, 39];
const PALLET_YS = [35, 41, 47, 53, 59, 65, 71];
const PALLET_GAPS = new Set(['21,53', '27,53', '33,41', '27,65']);

/** Cold-room fridge rows: [y, x0, x1]. */
const FRIDGE_ROWS: readonly (readonly [number, number, number])[] = [
  [32, 48, 56],
  [32, 62, 74],
  [37, 50, 58],
  [37, 62, 72],
  [47, 50, 58],
  [47, 62, 72],
];

/** Freezer cabinet columns (2 wide), rows 57–72 with a cross gap at 64–65. */
const FREEZER_XS = [50, 55, 60];

/** Meat & fish: counter row with an opening at its east end; behind it is the butcher's area. */
const COUNTER_ROW = 59;
const COUNTER_X: readonly [number, number] = [63, 73];

/** Checkout line at x = 81 between these rows; lanes are the gaps. */
const CHECKOUT_X = 81;
const CHECKOUT_LANES = new Set([20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 46, 47, 52, 53, 58, 59]);

/** Parked cars (1 × 2), top tiles. */
const CARS: readonly TilePoint[] = [
  [93, 6],
  [93, 10],
  [93, 18],
  [93, 26],
  [93, 50],
  [93, 58],
  [93, 66],
  [97, 8],
  [97, 14],
  [97, 22],
  [97, 54],
  [97, 62],
  [97, 70],
  [101, 6],
  [101, 18],
  [101, 30],
  [101, 48],
  [101, 60],
  [101, 72],
];
const PARKING_LINE_XS = [92, 96, 100];

// ── Objects ────────────────────────────────────────────────────────────────────────────────────

/** Van slot centres in tiles (vans are 2 × 3 tiles). Slots 1–8 west column, 9–16 east column. */
export const VAN_SLOT_TILES: readonly TilePoint[] = [3, 8].flatMap((x) =>
  Array.from({ length: 8 }, (_, i): TilePoint => [x, 6 + 8 * i + 1.5]),
);

/** Item spawn tiles per item zone. Positions are tile centres. */
export const ITEM_SPAWN_TILES: Readonly<Record<string, readonly TilePoint[]>> = {
  dry_goods: [
    [22, 18],
    [35, 5],
    [60, 5],
    [33, 10],
    [45, 10],
    [58, 10],
    [70, 10],
    [40, 15],
    [65, 15],
    [36, 20],
    [56, 20],
    [71, 20],
    [44, 25],
  ],
  beverages: [
    [19, 33],
    [44, 33],
    [24, 37],
    [30, 44],
    [36, 50],
    [42, 56],
    [25, 57],
    [19, 62],
    [30, 69],
    [36, 74],
  ],
  cold_room: [
    [48, 35],
    [55, 34],
    [66, 35],
    [74, 40],
    [52, 42],
    [60, 44],
    [70, 45],
    [49, 50],
    [58, 51],
    [72, 51],
  ],
  frozen: [
    [57, 55],
    [48, 58],
    [53, 60],
    [58, 62],
    [62, 68],
    [48, 70],
    [53, 72],
    [58, 74],
  ],
  // The first three sit behind the counter, inside the butcher's behind_counter zone (risk!).
  meat_fish: [
    [66, 56],
    [70, 57],
    [73, 55],
    [65, 62],
    [70, 63],
    [75, 61],
    [74, 70],
    [67, 72],
  ],
};

const NPC_SPAWN_TILES: readonly (readonly [string, number, number])[] = [
  ['security', 30, 9], // post at the staff-only door
  ['security', 85, 40], // entrance
  ['security', 76, 28],
  ['stocker', 40, 10],
  ['stocker', 62, 15],
  ['stocker', 30, 45],
  ['stocker', 43, 62],
  ['butcher', 69, 56],
];

const NPC_WAYPOINT_TILES: readonly TilePoint[] = [
  [30, 5],
  [50, 5],
  [75, 5],
  [30, 15],
  [50, 15],
  [75, 15],
  [30, 25],
  [50, 25],
  [75, 25],
  [18, 33],
  [44, 38],
  [24, 50],
  [44, 68],
  [18, 74],
  [52, 64],
  [62, 64],
];

/** Forklift loops (tile centres); the forklift drives back from the last point to the first. */
const FORKLIFT_ROUTES: readonly (readonly [string, readonly TilePoint[]])[] = [
  [
    'dry_goods_loop',
    [
      [50, 5],
      [50, 25],
      [74, 25],
      [74, 5],
    ],
  ],
  [
    'beverages_loop',
    [
      [24, 38],
      [42, 38],
      [42, 68],
      [24, 68],
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
    { id: 'loading_dock', name: 'Loading dock', polygon: rectPolygon([0, 3, 14, 76]) },
    { id: 'entrance', name: 'Entrance & checkout', polygon: rectPolygon([77, 4, 88, 75]) },
    {
      id: 'dry_goods',
      name: 'Dry goods',
      // Wraps around the staff-only room in the north-west corner.
      polygon: [
        [29, 4],
        [77, 4],
        [77, 31],
        [16, 31],
        [16, 15],
        [29, 15],
      ],
    },
    { id: 'beverages', name: 'Beverage pallets', polygon: rectPolygon([16, 31, 46, 75]) },
    {
      id: 'cold_room',
      name: 'Cold & dairy room',
      polygon: rectPolygon([47, 32, 75, 52]),
      friction: config.coldRoomFriction,
      speedMultiplier: config.coldRoomSpeedMultiplier,
    },
    { id: 'frozen', name: 'Freezer aisle', polygon: rectPolygon([47, 54, 62, 75]) },
    { id: 'meat_fish', name: 'Meat & fish counter', polygon: rectPolygon([63, 54, 76, 75]) },
    { id: 'behind_counter', name: 'Behind the counter', polygon: rectPolygon([64, 54, 76, 58]) },
    {
      id: 'staff_only',
      name: 'Staff-only back room',
      polygon: rectPolygon([16, 4, 27, 13]),
      wantedOnEnter: true,
    },
    { id: 'parking', name: 'Parking lot', polygon: rectPolygon([90, 3, 104, 76]) },
    { id: 'office', name: 'Office', polygon: rectPolygon([111, 30, 119, 49]) },
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
  ground.fill([0, 3, 11, 76], 'asphalt').fill([12, 3, 14, 76], 'dock');
  ground.fill([90, 3, 103, 76], 'asphalt');
  for (const x of PARKING_LINE_XS) ground.fill([x, 3, x, 76], 'parking_line');
  ground.fill([104, 0, 104, MAP_HEIGHT - 1], 'sidewalk').fill([110, 0, 110, MAP_HEIGHT - 1], 'sidewalk');
  ground.fill([STREET_X[0], 0, STREET_X[1], MAP_HEIGHT - 1], 'road');
  for (let y = 0; y < MAP_HEIGHT; y += 2) ground.set(107, y, 'road_line');

  // Tree lines along the top and bottom edges, west of the street.
  for (const y of [0, 1, 2, 77, 78, 79]) walls.fill([0, y, STREET_X[0] - 2, y], 'tree');
  for (const y of [0, 1, 2, 77, 78, 79]) ground.fill([0, y, STREET_X[0] - 2, y], 'grass');

  // Store shell and floors.
  ground.fill([STORE[0] + 1, STORE[1] + 1, STORE[2] - 1, STORE[3] - 1], 'floor');
  ground.fill([16, 31, 45, 75], 'floor_alt');
  walls.outline(STORE, 'wall');
  for (const x of [20, 40, 60, 80]) walls.set(x, STORE[1], 'wall_window').set(x, STORE[3], 'wall_window');
  for (const [y0, y1] of DOCK_GATES) {
    walls.fill([STORE[0], y0, STORE[0], y1], null);
    ground.fill([STORE[0], y0, STORE[0], y1], 'dock');
    decor.fill([STORE[0] - 1, y0, STORE[0] - 1, y1], 'hazard');
  }
  walls.fill([STORE[2], ENTRANCE_DOOR[0], STORE[2], ENTRANCE_DOOR[1]], null);
  ground.fill([STORE[2], ENTRANCE_DOOR[0], STORE[2], ENTRANCE_DOOR[1]], 'door');
  ground.fill([86, ENTRANCE_DOOR[0], 88, ENTRANCE_DOOR[1]], 'entrance_mat');
  above.set(STORE[2], ENTRANCE_DOOR[0] - 1, 'sign').set(STORE[2], ENTRANCE_DOOR[1] + 1, 'sign');

  // Staff-only room: the shortcut from the dock to the back of the store.
  ground.fill([16, 4, 27, 13], 'floor_staff');
  walls.fill([STAFF_ROOM[0], STAFF_ROOM[3], STAFF_ROOM[2], STAFF_ROOM[3]], 'wall');
  walls.fill([STAFF_ROOM[2], STAFF_ROOM[1], STAFF_ROOM[2], STAFF_ROOM[3]], 'wall');
  walls.fill([STORE[0], STAFF_DOCK_DOOR[0], STORE[0], STAFF_DOCK_DOOR[1]], null);
  ground.fill([STORE[0], STAFF_DOCK_DOOR[0], STORE[0], STAFF_DOCK_DOOR[1]], 'staff_door');
  walls.fill([STAFF_ROOM[2], STAFF_STORE_DOOR[0], STAFF_ROOM[2], STAFF_STORE_DOOR[1]], null);
  ground.fill([STAFF_ROOM[2], STAFF_STORE_DOOR[0], STAFF_ROOM[2], STAFF_STORE_DOOR[1]], 'staff_door');
  walls.set(18, 5, 'crate').set(19, 5, 'crate').set(25, 12, 'crate');
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
    walls.fill([x, 57, x + 1, 63], 'freezer').fill([x, 66, x + 1, 72], 'freezer');
  }

  // Meat & fish counter; the butcher works behind it.
  walls.fill([COUNTER_X[0], COUNTER_ROW, COUNTER_X[1], COUNTER_ROW], 'counter');
  walls.fill([COUNTER_X[0], 54, COUNTER_X[0], COUNTER_ROW], 'counter');
  ground.fill([64, 54, 76, 58], 'floor_alt');
  walls.fill([66, 66, 73, 66], 'fridge');
  decor.fill([74, COUNTER_ROW, 76, COUNTER_ROW], 'hazard');

  // Entrance: checkout line with lanes, trolley rows at both ends.
  for (let y = STORE[1] + 1; y < STORE[3]; y++) {
    if (CHECKOUT_LANES.has(y)) continue;
    walls.set(CHECKOUT_X, y, y < 17 || y > 61 ? 'trolley' : 'checkout');
  }
  walls.fill([86, 6, 87, 14], 'trolley').fill([86, 65, 87, 73], 'trolley');

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
  ground.fill([111, OFFICE_DOOR[0], 111, OFFICE_DOOR[1]], 'sidewalk');
  walls
    .set(115, 35, 'office_desk')
    .set(116, 35, 'office_desk')
    .set(115, 44, 'office_desk')
    .set(116, 44, 'office_desk');
  walls.set(OFFICE_BUILDING[0], 35, 'wall_window').set(OFFICE_BUILDING[0], 44, 'wall_window');
  above.set(OFFICE_BUILDING[0], OFFICE_DOOR[0] - 1, 'sign');
  for (const [x, y] of [
    [114, 10],
    [117, 20],
    [113, 26],
    [116, 54],
    [113, 62],
    [118, 70],
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

  const vanSlots = VAN_SLOT_TILES.map(([x, y], i) =>
    point(px(x), px(y), `van_${i + 1}`, [{ name: 'index', type: 'int', value: i + 1 }]),
  );

  const itemSpawns = Object.entries(ITEM_SPAWN_TILES).flatMap(([zone, spots]) =>
    spots.map(([x, y]) => point(centre(x), centre(y), '', [{ name: 'zone', type: 'string', value: zone }])),
  );

  const npcSpawns = NPC_SPAWN_TILES.map(([type, x, y]) =>
    point(centre(x), centre(y), type, [{ name: 'type', type: 'string', value: type }]),
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
  const rows = new Map<string, string>();
  const json = JSON.stringify(
    map,
    (key, value: unknown) => {
      if (key === 'data' && Array.isArray(value)) {
        const token = `__tile_data_${rows.size}__`;
        const lines: string[] = [];
        for (let i = 0; i < value.length; i += MAP_WIDTH) lines.push(value.slice(i, i + MAP_WIDTH).join(','));
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
