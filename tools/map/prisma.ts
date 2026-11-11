// The second store's blockout map (phase 2 P1-4, §9.2, §15.4): a consumer supermarket, built from code
// like tools/map/kespro.ts. `npm run gen:map` writes maps/prisma.tmj; tools/gen-prisma-map.test.ts and
// tools/prisma-play.test.ts check it.
//
// Layout (tile coordinates, 100 × 72; the store's front faces south onto the parking lot):
//   x 2–73, y 2–43   the store (walled). Back row: dairy fridges (west) and the staff-only stockroom
//                    (east, one forklift loop, doors to the dairy aisle and the freezers, a guard post).
//                    Middle: bakery with the oven (west wall) over produce stands, pantry shelves in
//                    2-tile aisles, chest freezers, the deli service counter (butcher behind it) over
//                    the drinks aisle. Front row: entrance doors (west), the self-checkout line with
//                    one-tile gate lanes and the exit doors behind it, candy bins, and the
//                    bottle-return alcove (a dead end off the drinks aisle).
//   y 44–69          sidewalk and the customer parking lot: 16 van slots in two rows in the west half,
//                    the cart corral pen next to the exit, parked cars as cover in the east half.
//   x 78–84          the road (sidewalks both sides, a crosswalk to the office door).
//   x 85–99          the office building across the road with the race-mode office trigger.
// Tree lines along the top and bottom edges (west of the road) and the west edge frame the lot.
// Room is left for the phase 2 twists, whose object layers come later: gate lanes in the checkout line
// and the doorways (P2-1), the oven floor (P2-2), the corral pen (P2-5), the bottle-return alcove (P2-6).
import { TILE } from '../art/tiles';
import { PRISMA_TILES, prismaTileIndex, type PrismaTileName } from '../art/prismaTiles';

export const MAP_WIDTH = 100;
export const MAP_HEIGHT = 72;

/** Inclusive tile rectangle. */
type Rect = readonly [x0: number, y0: number, x1: number, y1: number];
type TilePoint = readonly [tx: number, ty: number];

class TileLayer {
  readonly data: number[] = new Array<number>(MAP_WIDTH * MAP_HEIGHT).fill(0);

  set(x: number, y: number, name: PrismaTileName | null): this {
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) throw new Error(`tile ${x},${y} off map`);
    this.data[y * MAP_WIDTH + x] = name === null ? 0 : prismaTileIndex(name) + 1;
    return this;
  }

  fill([x0, y0, x1, y1]: Rect, name: PrismaTileName | null): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, name);
    return this;
  }

  /** The four edges of a rectangle. */
  outline([x0, y0, x1, y1]: Rect, name: PrismaTileName): this {
    return this.fill([x0, y0, x1, y0], name)
      .fill([x0, y1, x1, y1], name)
      .fill([x0, y0, x0, y1], name)
      .fill([x1, y0, x1, y1], name);
  }
}

// ── Areas ──────────────────────────────────────────────────────────────────────────────────────

const STORE: Rect = [2, 2, 73, 43]; // walls included
const FRONT_Y = STORE[3];
const STOCKROOM: Rect = [43, 2, 73, 13]; // walls included (shares the store's north and east walls)
const OFFICE_BUILDING: Rect = [87, 26, 97, 41]; // walls included
const ROAD_X: readonly [number, number] = [79, 83];

/** Doorways in the store front (columns in y = FRONT_Y). */
export const ENTRANCE_DOORS: readonly [number, number] = [5, 8];
export const EXIT_DOORS: readonly [number, number] = [21, 24];
/** Stockroom staff doors: rows in its west wall (x = 43) and columns in its south wall (y = 13). */
const STAFF_WEST_DOOR: readonly [number, number] = [9, 10];
const STAFF_SOUTH_DOOR: readonly [number, number] = [47, 48];
const OFFICE_DOOR: readonly [number, number] = [32, 35]; // rows in x = 87

/**
 * Self-checkout line (row y = CHECKOUT_Y, x 12–34): kiosks with one-tile gate lanes, the only way from
 * the store to the exit strip behind it (y 40–42), which leads to the exit doors. A wall at x = 11
 * keeps the exit strip apart from the entrance, and one at x = 35 from the candy aisle.
 */
const CHECKOUT_Y = 39;
const CHECKOUT_X: readonly [number, number] = [12, 34];
export const GATE_LANES: readonly number[] = [14, 18, 22, 26, 30, 33];

/**
 * One-way gates (P2-1, phase 2 decision 9), the `gates` object layer: a self-checkout gate on every lane
 * (out of the store, south, with the stop) and the entrance doors (into the store, north, no stop). So a
 * player comes in through the entrance and leaves through the checkout; the exit doors stay plain.
 */
export const GATES: readonly { rect: Rect; dir: 'n' | 'e' | 's' | 'w'; kind: 'checkout' | 'door' }[] = [
  ...GATE_LANES.map((x) => ({
    rect: [x, CHECKOUT_Y, x, CHECKOUT_Y] as Rect,
    dir: 's' as const,
    kind: 'checkout' as const,
  })),
  { rect: [ENTRANCE_DOORS[0], FRONT_Y, ENTRANCE_DOORS[1], FRONT_Y], dir: 'n', kind: 'door' },
];

/** Oven: oven tiles on the west wall, hot floor in front of them (the `oven` hazard sub-zone). */
const OVEN_ROWS: readonly [number, number] = [16, 21];
export const OVEN_HEAT: Rect = [4, OVEN_ROWS[0], 5, OVEN_ROWS[1]];
/** HP per second on the hot floor (phase 2 decision 10), burnt in `hazardTickSeconds` steps. */
export const OVEN_DAMAGE_PER_SECOND = 8;

/** Deli service counter: a row with a west end column and an opening at its east end. */
const DELI_COUNTER_Y = 19;
const DELI_COUNTER_X: readonly [number, number] = [57, 70];

/** Bottle-return alcove: walls on its west and north side, open at x 71–72 to the drinks aisle. */
const ALCOVE: Rect = [64, 36, 72, 42]; // west/north walls included
const BOTTLE_MACHINES: Rect = [66, 42, 69, 42];
/** The bottle machines' hum (P2-6): a looping ambient sound heard within this many tiles. */
const BOTTLE_HUM_RADIUS_TILES = 9;

/** Cart corral pen outside, east of the exit: rails on three sides, open to the west. */
export const CORRAL: Rect = [28, 46, 37, 50];

/**
 * Pushable carts (P2-5): 8 in the corral, two rows with a free tile east of each cart and the middle row
 * open, so a player can walk in and push every cart out of the open west side. Noses point west.
 */
export const CART_SPAWN_TILES: readonly TilePoint[] = [47, 49].flatMap((y) =>
  [29, 31, 33, 35].map((x): TilePoint => [x, y]),
);

/** Pantry gondolas: 1-tile rows with 2-tile aisles between; cross aisles at x 17–18, 30–31, 41–42. */
const SHELF_ROWS = [15, 18, 21, 24, 27, 30, 33];
const SHELF_SPANS: readonly (readonly [number, number])[] = [
  [19, 29],
  [32, 40],
];

/** Dairy fridges: the back wall row and two island rows [y, x0, x1]. */
const DAIRY_FRIDGES: readonly (readonly [number, number, number])[] = [
  [3, 4, 41],
  [7, 6, 19],
  [7, 23, 39],
  [10, 6, 19],
  [10, 23, 39],
];

/** Chest freezer islands (2 wide): [x, y0, y1]. */
const FREEZERS: readonly (readonly [number, number, number])[] = [45, 50, 54].flatMap((x) => [
  [x, 17, 22] as const,
  [x, 26, 32] as const,
]);

/** Produce stands (2 × 2), top-left tiles. */
const PRODUCE_STANDS: readonly TilePoint[] = [5, 9, 13].flatMap((x) => [[x, 27] as const, [x, 31] as const]);

/** Candy bins (2 × 1), left tiles. */
const CANDY_BINS: readonly TilePoint[] = [38, 42, 46, 50, 54, 58].flatMap((x) => [
  [x, 38] as const,
  [x, 41] as const,
]);

/** Stockroom racks and pallets (inside the forklift loop and in its corners). */
const STOCK_RACKS: readonly Rect[] = [
  [48, 7, 68, 7],
  [48, 9, 68, 9],
];
const STOCK_PALLETS: readonly Rect[] = [
  [44, 3, 45, 3],
  [71, 3, 72, 3],
  [71, 12, 72, 12],
];

/** Drinks: a fridge row and pallet stacks (2 × 2). */
const DRINK_FRIDGE: Rect = [59, 27, 69, 27];
const DRINK_PALLETS: readonly TilePoint[] = [
  [59, 30],
  [63, 30],
  [67, 30],
];

/** Parked cars (1 × 2), top tiles, in the east half of the lot and in the lane between the van rows. */
const CARS: readonly TilePoint[] = [
  [36, 52],
  [40, 52],
  [46, 52],
  [52, 52],
  [58, 52],
  [64, 52],
  [70, 52],
  [38, 62],
  [44, 62],
  [50, 62],
  [56, 62],
  [62, 62],
  [68, 62],
  [74, 57],
  [30, 58],
  [16, 58],
];

// ── Objects ────────────────────────────────────────────────────────────────────────────────────

/** Van slot centres in tiles (vans are 2 × 3 tiles). Slots 1–8 front row, 9–16 back row, west to east. */
export const VAN_SLOT_TILES: readonly TilePoint[] = [53.5, 63.5].flatMap((y) =>
  Array.from({ length: 8 }, (_, i): TilePoint => [4 + 3 * i, y]),
);
/**
 * Van slot `index` of team 1's and team 2's van with Teams on (P1 review F3). Slots 1 and 2 stand 3 tiles
 * apart here, so Teams rounds opened with a fight at the vans. Slots 1 (front row, west end) and 12 (back
 * row) are 13.5 tiles apart, and their mean walk to the item spawns (54 and 59 tiles) and to the office (92
 * and 87) differ by under 10 %, the closest pair at least 8 tiles apart (tools/prisma-play.test.ts).
 */
export const TEAM_VAN_SLOTS: readonly [number, number] = [1, 12];
const VAN_ROWS: readonly [number, number][] = [
  [52, 54],
  [62, 64],
];

/** Item spawn tiles per item zone (P1-3 catalogue zones). Positions are tile centres. */
export const ITEM_SPAWN_TILES: Readonly<Record<string, readonly TilePoint[]>> = {
  produce: [
    [4, 26],
    [11, 26],
    [7, 30],
    [15, 30],
    [4, 34],
    [12, 34],
  ],
  bakery: [
    [7, 15],
    [12, 15],
    [10, 19],
    [15, 19],
    [7, 23],
    [13, 23],
  ],
  dairy: [
    [5, 5],
    [12, 5],
    [25, 5],
    [38, 5],
    [10, 8],
    [30, 9],
    [15, 12],
    [36, 12],
  ],
  frozen: [
    [44, 19],
    [48, 20],
    [53, 18],
    [48, 29],
    [53, 30],
    [56, 34],
    [44, 34],
  ],
  pantry: [
    [24, 14],
    [36, 14],
    [22, 17],
    [35, 20],
    [26, 23],
    [30, 25],
    [38, 26],
    [21, 29],
    [34, 29],
    [27, 32],
    [37, 35],
  ],
  // The last two sit in the bottle-return dead end (§9.2, decision 11): they are the odd spots.
  drinks: [
    [58, 26],
    [66, 28],
    [62, 33],
    [70, 34],
    [67, 39],
    [70, 40],
  ],
  candy: [
    [40, 37],
    [57, 37],
    [52, 40],
    [45, 42],
    [61, 42],
  ],
  // The first two sit behind the counter, inside the butcher's behind_counter zone.
  deli: [
    [60, 15],
    [68, 16],
    [59, 23],
    [63, 22],
    [69, 23],
  ],
};

/**
 * Item spawns marked `oddSpot: true` (§10.1, phase 2 decision 11): joke items appear here first when
 * one is free. On this map that is the bottle-return dead end. Each must be a tile in ITEM_SPAWN_TILES.
 */
export const ODD_SPOT_TILES: readonly TilePoint[] = [
  [67, 39],
  [70, 40],
];

/** [type, x, y, post]: `post` makes the NPC stand guard there instead of patrolling (§8). */
const NPC_SPAWN_TILES: readonly (readonly [string, number, number, boolean?])[] = [
  ['security', 48, 15, true], // post at the stockroom's south door
  ['security', 25, 37], // inside the self-checkout line
  ['security', 41, 24],
  ['stocker', 24, 13],
  ['stocker', 36, 20],
  ['stocker', 50, 24],
  ['stocker', 64, 33],
  ['stocker', 12, 30],
  ['butcher', 64, 16],
  // Customer groups (P2-3): one group per spawn, in this order (6 customers fill the first two), each on
  // an aisle waypoint.
  ['customer', 31, 22],
  ['customer', 62, 26],
  ['customer', 10, 25],
  ['customer', 40, 36],
];

const NPC_WAYPOINT_TILES: readonly TilePoint[] = [
  [8, 12],
  [30, 12],
  [18, 16],
  [31, 22],
  [41, 30],
  [17, 33],
  [10, 25],
  [10, 37],
  [25, 37],
  [40, 36],
  [55, 37],
  [48, 24],
  [56, 16],
  [62, 26],
  [71, 30],
  [52, 34],
];

/** The stockroom forklift loop (tile centres); the forklift drives back from the last point to the first. */
const FORKLIFT_ROUTES: readonly (readonly [string, readonly TilePoint[]])[] = [
  [
    'stockroom_loop',
    [
      [46, 5],
      [70, 5],
      [70, 11],
      [46, 11],
    ],
  ],
];

interface ZoneSpec {
  id: string;
  name: string;
  /** Polygon in tile-edge coordinates. */
  polygon: readonly TilePoint[];
  wantedOnEnter?: boolean;
  /** Floor hazard (P2-2): HP per second taken while standing in the zone. */
  damagePerSecond?: number;
}

const rectPolygon = ([x0, y0, x1, y1]: Rect): TilePoint[] => [
  [x0, y0],
  [x1 + 1, y0],
  [x1 + 1, y1 + 1],
  [x0, y1 + 1],
];

/** Zones of phase 2 decision 4. Nested zones (oven, behind_counter, bottle_return) win in `zoneAt`. */
function zoneSpecs(): ZoneSpec[] {
  return [
    { id: 'dairy', name: 'Dairy', polygon: rectPolygon([3, 3, 42, 13]) },
    { id: 'stockroom', name: 'Stockroom', polygon: rectPolygon([44, 3, 72, 12]), wantedOnEnter: true },
    { id: 'bakery', name: 'Bakery', polygon: rectPolygon([3, 14, 16, 24]) },
    { id: 'oven', name: 'Oven', polygon: rectPolygon(OVEN_HEAT), damagePerSecond: OVEN_DAMAGE_PER_SECOND },
    { id: 'produce', name: 'Fruit & vegetables', polygon: rectPolygon([3, 25, 16, 35]) },
    { id: 'pantry', name: 'Pantry aisles', polygon: rectPolygon([17, 14, 42, 35]) },
    { id: 'frozen', name: 'Freezers', polygon: rectPolygon([43, 14, 56, 35]) },
    { id: 'deli', name: 'Deli counter', polygon: rectPolygon([57, 14, 72, 24]) },
    { id: 'behind_counter', name: 'Behind the counter', polygon: rectPolygon([58, 14, 72, 18]) },
    {
      id: 'drinks',
      name: 'Drinks',
      // The aisle plus the bottle-return alcove south of it.
      polygon: [
        [57, 25],
        [73, 25],
        [73, 43],
        [ALCOVE[0], 43],
        [ALCOVE[0], 36],
        [57, 36],
      ],
    },
    {
      id: 'bottle_return',
      name: 'Bottle return',
      polygon: rectPolygon([ALCOVE[0] + 1, ALCOVE[1] + 1, 72, 42]),
    },
    { id: 'candy', name: 'Candy', polygon: rectPolygon([35, 36, 63, 42]) },
    { id: 'entrance', name: 'Entrance', polygon: rectPolygon([3, 36, 10, 42]) },
    { id: 'self_checkout', name: 'Self-checkout', polygon: rectPolygon([11, 36, 34, 42]) },
    { id: 'parking', name: 'Parking lot', polygon: rectPolygon([0, 44, 77, 69]) },
    { id: 'cart_corral', name: 'Cart corral', polygon: rectPolygon(CORRAL) },
    { id: 'street', name: 'Street', polygon: rectPolygon([78, 0, 84, MAP_HEIGHT - 1]) },
    { id: 'office', name: 'Office', polygon: rectPolygon([85, 24, 99, 43]) },
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

  // Outside: grass, sidewalk along the store front, the parking lot, the road.
  ground.fill([0, 0, MAP_WIDTH - 1, MAP_HEIGHT - 1], 'grass');
  ground.fill([0, FRONT_Y + 1, 77, FRONT_Y + 2], 'sidewalk');
  ground.fill([0, FRONT_Y + 3, 77, 69], 'asphalt');
  for (const [y0, y1] of VAN_ROWS) {
    for (let x = 2; x <= 26; x += 3) ground.fill([x, y0 - 1, x, y1 + 1], 'parking_line');
  }
  ground.fill([ROAD_X[0] - 1, 0, ROAD_X[0] - 1, MAP_HEIGHT - 1], 'sidewalk');
  ground.fill([ROAD_X[1] + 1, 0, ROAD_X[1] + 1, MAP_HEIGHT - 1], 'sidewalk');
  ground.fill([ROAD_X[0], 0, ROAD_X[1], MAP_HEIGHT - 1], 'road');
  for (let y = 0; y < MAP_HEIGHT; y += 2) ground.set(81, y, 'road_line');
  ground.fill([ROAD_X[0], OFFICE_DOOR[0], ROAD_X[1], OFFICE_DOOR[1]], 'crosswalk');

  // Tree lines: top and bottom edges west of the road, and the strip west of the store.
  for (const y of [0, 1, 70, 71]) walls.fill([0, y, ROAD_X[0] - 2, y], 'tree');
  walls.fill([0, 2, 1, FRONT_Y], 'tree');
  for (const [x, y] of [
    [75, 8],
    [76, 22],
    [75, 36],
  ] as const) {
    walls.set(x, y, 'tree');
  }

  // Store shell and floors.
  ground.fill([STORE[0] + 1, STORE[1] + 1, STORE[2] - 1, STORE[3] - 1], 'floor');
  ground.fill([17, 14, 42, 35], 'floor_alt');
  ground.fill([3, 3, 42, 13], 'floor_cold');
  ground.fill([43, 14, 56, 35], 'floor_cold');
  ground.fill([3, 14, 16, 24], 'floor_bakery');
  walls.outline(STORE, 'wall');
  for (const x of [14, 30, 45, 60, 68]) walls.set(x, FRONT_Y, 'wall_window');
  for (const x of [10, 25, 35]) walls.set(x, STORE[1], 'wall_window');

  // Front doors: sliding doors in, sliding doors out behind the self-checkout.
  for (const [x0, x1] of [ENTRANCE_DOORS, EXIT_DOORS]) {
    walls.fill([x0, FRONT_Y, x1, FRONT_Y], null);
    ground.fill([x0, FRONT_Y, x1, FRONT_Y], 'sliding_door');
    above.set(x0 - 1, FRONT_Y, 'sign').set(x1 + 1, FRONT_Y, 'sign');
  }
  ground.fill([ENTRANCE_DOORS[0], 41, ENTRANCE_DOORS[1], 42], 'entrance_mat');
  ground.fill([EXIT_DOORS[0], 41, EXIT_DOORS[1], 42], 'entrance_mat');

  // Self-checkout: kiosks with one-tile gate lanes, walls closing the exit strip at both ends.
  for (let x = CHECKOUT_X[0]; x <= CHECKOUT_X[1]; x++) {
    if (GATE_LANES.includes(x)) ground.set(x, CHECKOUT_Y, 'gate_lane');
    else walls.set(x, CHECKOUT_Y, 'checkout_kiosk');
  }
  walls.fill([CHECKOUT_X[0] - 1, CHECKOUT_Y, CHECKOUT_X[0] - 1, FRONT_Y - 1], 'wall');
  walls.fill([CHECKOUT_X[1] + 1, CHECKOUT_Y, CHECKOUT_X[1] + 1, FRONT_Y - 1], 'wall');

  // Stockroom: staff floor, two staff doors, racks inside the forklift loop.
  ground.fill([STOCKROOM[0] + 1, STOCKROOM[1] + 1, STOCKROOM[2] - 1, STOCKROOM[3] - 1], 'floor_staff');
  walls.fill([STOCKROOM[0], STOCKROOM[1], STOCKROOM[0], STOCKROOM[3]], 'wall');
  walls.fill([STOCKROOM[0], STOCKROOM[3], STOCKROOM[2], STOCKROOM[3]], 'wall');
  walls.fill([STOCKROOM[0], STAFF_WEST_DOOR[0], STOCKROOM[0], STAFF_WEST_DOOR[1]], null);
  ground.fill([STOCKROOM[0], STAFF_WEST_DOOR[0], STOCKROOM[0], STAFF_WEST_DOOR[1]], 'staff_door');
  walls.fill([STAFF_SOUTH_DOOR[0], STOCKROOM[3], STAFF_SOUTH_DOOR[1], STOCKROOM[3]], null);
  ground.fill([STAFF_SOUTH_DOOR[0], STOCKROOM[3], STAFF_SOUTH_DOOR[1], STOCKROOM[3]], 'staff_door');
  above.set(STOCKROOM[0], STAFF_WEST_DOOR[0] - 1, 'sign').set(STAFF_SOUTH_DOOR[0] - 1, STOCKROOM[3], 'sign');
  for (const r of STOCK_RACKS) walls.fill(r, 'rack');
  for (const r of STOCK_PALLETS) walls.fill(r, 'pallet_stack');

  // Dairy: fridges along the back wall and two island rows.
  for (const [y, x0, x1] of DAIRY_FRIDGES) walls.fill([x0, y, x1, y], 'fridge');

  // Bakery: the oven on the west wall with its hot floor, a bread counter and a low shelf.
  walls.fill([3, OVEN_ROWS[0], 3, OVEN_ROWS[1]], 'oven');
  ground.fill(OVEN_HEAT, 'oven_heat');
  walls.fill([8, 17, 14, 17], 'bakery_counter');
  walls.fill([8, 21, 14, 21], 'shelf_low');

  // Produce stands.
  for (const [x, y] of PRODUCE_STANDS) walls.fill([x, y, x + 1, y + 1], 'produce_stand');

  // Pantry: low gondolas with end caps.
  for (const y of SHELF_ROWS) {
    for (const [x0, x1] of SHELF_SPANS) {
      walls.fill([x0 + 1, y, x1 - 1, y], 'shelf_low');
      walls.set(x0, y, 'shelf_end').set(x1, y, 'shelf_end');
    }
  }

  // Chest freezers.
  for (const [x, y0, y1] of FREEZERS) walls.fill([x, y0, x + 1, y1], 'freezer_chest');

  // Deli: service counter, the butcher's floor behind it, hazard stripe at the opening.
  ground.fill([DELI_COUNTER_X[0] + 1, 14, 72, DELI_COUNTER_Y - 1], 'floor_staff');
  walls.fill([DELI_COUNTER_X[0], DELI_COUNTER_Y, DELI_COUNTER_X[1], DELI_COUNTER_Y], 'deli_counter');
  walls.fill([DELI_COUNTER_X[0], 14, DELI_COUNTER_X[0], DELI_COUNTER_Y], 'deli_counter');
  decor.fill([DELI_COUNTER_X[1] + 1, DELI_COUNTER_Y, 72, DELI_COUNTER_Y], 'hazard');

  // Drinks: a fridge row and pallet stacks.
  walls.fill(DRINK_FRIDGE, 'fridge');
  for (const [x, y] of DRINK_PALLETS) walls.fill([x, y, x + 1, y + 1], 'pallet_stack');

  // Bottle-return alcove: a dead end with the machines on its back wall.
  walls.fill([ALCOVE[0], ALCOVE[1], ALCOVE[0], ALCOVE[3]], 'wall');
  walls.fill([ALCOVE[0], ALCOVE[1], 70, ALCOVE[1]], 'wall');
  walls.fill(BOTTLE_MACHINES, 'bottle_machine');

  // Candy bins in front of the checkout.
  for (const [x, y] of CANDY_BINS) walls.fill([x, y, x + 1, y], 'candy_bins');

  // Forklift route corners get hazard markings on the floor.
  for (const [, points] of FORKLIFT_ROUTES) for (const [x, y] of points) decor.set(x, y, 'hazard');

  // Cart corral pen: rails on the north, east and south sides.
  const [cx0, cy0, cx1, cy1] = CORRAL;
  ground.fill(CORRAL, 'corral_floor');
  walls.fill([cx0, cy0, cx1, cy0], 'corral_rail').fill([cx0, cy1, cx1, cy1], 'corral_rail');
  walls.fill([cx1, cy0, cx1, cy1], 'corral_rail');

  // Parked cars.
  for (const [x, y] of CARS) walls.fill([x, y, x, y + 1], 'car');

  // The office across the road.
  ground.fill(
    [OFFICE_BUILDING[0] + 1, OFFICE_BUILDING[1] + 1, OFFICE_BUILDING[2] - 1, OFFICE_BUILDING[3] - 1],
    'floor_office',
  );
  walls.outline(OFFICE_BUILDING, 'wall');
  walls.fill([OFFICE_BUILDING[0], OFFICE_DOOR[0], OFFICE_BUILDING[0], OFFICE_DOOR[1]], null);
  ground.fill([OFFICE_BUILDING[0], OFFICE_DOOR[0], OFFICE_BUILDING[0], OFFICE_DOOR[1]], 'door');
  ground.fill([ROAD_X[1] + 2, OFFICE_DOOR[0], OFFICE_BUILDING[0] - 1, OFFICE_DOOR[1]], 'sidewalk');
  walls.fill([91, 29, 92, 29], 'office_desk').fill([91, 38, 92, 38], 'office_desk');
  walls.set(OFFICE_BUILDING[0], 29, 'wall_window').set(OFFICE_BUILDING[0], 38, 'wall_window');
  above.set(OFFICE_BUILDING[0], OFFICE_DOOR[0] - 1, 'sign');
  for (const [x, y] of [
    [90, 8],
    [95, 15],
    [93, 50],
    [97, 60],
    [89, 66],
  ] as const) {
    walls.set(x, y, 'tree');
  }

  return { ground, walls, decor, above };
}

// ── Tiled JSON ─────────────────────────────────────────────────────────────────────────────────

type Property = { name: string; type: 'string' | 'int' | 'float' | 'bool'; value: string | number | boolean };

const px = (tiles: number): number => tiles * TILE;
const centre = (tile: number): number => (tile + 0.5) * TILE;

/** Builds the map as Tiled JSON. `tileset` is the parsed maps/prisma_tiles.tsj, embedded like the first map's. */
export function buildPrismaMap(tileset: Record<string, unknown>): Record<string, unknown> {
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

  const zones = zoneSpecs().map((z) => {
    const [ox, oy] = z.polygon[0] as TilePoint;
    const properties: Property[] = [{ name: 'id', type: 'string', value: z.id }];
    if (z.wantedOnEnter) properties.push({ name: 'wantedOnEnter', type: 'bool', value: true });
    if (z.damagePerSecond !== undefined) {
      properties.push({ name: 'damagePerSecond', type: 'float', value: z.damagePerSecond });
    }
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

  const cartSpawns = CART_SPAWN_TILES.map(([x, y], i) =>
    point(centre(x), centre(y), `cart_${i + 1}`, [{ name: 'dir', type: 'string', value: 'left' }]),
  );

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

  // Made last so adding it leaves every other object id unchanged.
  const ambientSounds = [
    point(px((BOTTLE_MACHINES[0] + BOTTLE_MACHINES[2] + 1) / 2), centre(BOTTLE_MACHINES[1]), 'bottle_hum', [
      { name: 'sound', type: 'string', value: 'bottleHum' },
      { name: 'radius', type: 'float', value: px(BOTTLE_HUM_RADIUS_TILES) },
    ]),
  ];

  // After the ambient sounds, so adding it left every earlier object id unchanged.
  const gates = GATES.map(({ rect: [x0, y0, x1, y1], dir, kind }, i) =>
    object(
      { name: `${kind}_${i + 1}`, x: px(x0), y: px(y0), width: px(x1 - x0 + 1), height: px(y1 - y0 + 1) },
      [
        { name: 'dir', type: 'string', value: dir },
        { name: 'kind', type: 'string', value: kind },
      ],
    ),
  );

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
    objectLayer(12, 'ambient_sounds', ambientSounds),
    objectLayer(13, 'gates', gates),
    objectLayer(14, 'cart_spawns', cartSpawns),
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

/** Names of tiles the walls layer may contain (solid) and the above layer may contain. */
export const SOLID_TILES = new Set<string>(PRISMA_TILES.filter((t) => t.solid).map((t) => t.name));
export const ABOVE_TILES = new Set<string>(
  PRISMA_TILES.filter((t) => 'above' in t && t.above).map((t) => t.name),
);
