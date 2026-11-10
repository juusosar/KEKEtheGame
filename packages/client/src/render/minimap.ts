// Minimap model (§13.2): what the corner map shows and where, as plain data. No DOM or Phaser here, so
// the marker rules are unit-tested; MinimapView.ts draws the result onto a canvas.
//
// Adding a marker later (office and box carriers in M6; forklifts came in M5-7):
//   1. add its kind to MARKER_STYLES (shape, size, draw order),
//   2. write a MinimapLayer that turns the synced state (`world.state`) into markers of that kind,
//   3. append the layer to the list passed to buildMinimapMarkers (or to DEFAULT_LAYERS).
import { isBag, mapEntries, num, str } from '../net/lobbyView';
import { readNpcs } from '../net/npcView';

export interface Vec {
  readonly x: number;
  readonly y: number;
}

// --- projection -------------------------------------------------------------------------------------

/** How the map fits the minimap box: one uniform scale, aspect ratio kept. */
export interface MinimapFit {
  /** Minimap size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Minimap pixels per world pixel. */
  readonly scale: number;
}

/** Largest uniform scale that fits a `mapW` × `mapH` world into `maxW` × `maxH`. */
export function fitMinimap(mapW: number, mapH: number, maxW: number, maxH: number): MinimapFit {
  if (mapW <= 0 || mapH <= 0 || maxW <= 0 || maxH <= 0) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(maxW / mapW, maxH / mapH);
  return { width: Math.round(mapW * scale), height: Math.round(mapH * scale), scale };
}

/** World pixels → minimap pixels, clamped to the minimap so off-map markers stay on its edge. */
export function projectToMinimap(fit: MinimapFit, p: Vec): Vec {
  return {
    x: Math.min(fit.width, Math.max(0, p.x * fit.scale)),
    y: Math.min(fit.height, Math.max(0, p.y * fit.scale)),
  };
}

// --- markers ----------------------------------------------------------------------------------------

export type MarkerShape = 'square' | 'circle' | 'diamond' | 'triangle';

export interface MarkerStyle {
  readonly shape: MarkerShape;
  /** Width in CSS pixels. */
  readonly size: number;
  /** Draw order: higher is drawn on top. */
  readonly z: number;
  /** Fill colour when the marker brings none (`#RRGGBB`). */
  readonly color: string;
  /** Slow blink (target), so it reads at a glance. */
  readonly pulse?: boolean;
}

/** Marker kinds and how they look. Later milestones add their kinds here (see the header). */
export const MARKER_STYLES = {
  van: { shape: 'square', size: 7, z: 1, color: '#9E9E9E' },
  loose: { shape: 'circle', size: 4, z: 2, color: '#F5F5F5' },
  forklift: { shape: 'square', size: 6, z: 2.5, color: '#FF9800', pulse: true },
  target: { shape: 'diamond', size: 9, z: 3, color: '#FFD600', pulse: true },
  self: { shape: 'triangle', size: 8, z: 4, color: '#FFFFFF' },
} as const satisfies Record<string, MarkerStyle>;

export type MinimapMarkerKind = keyof typeof MARKER_STYLES;

export interface MinimapMarker {
  /** A key of MARKER_STYLES. */
  readonly kind: MinimapMarkerKind;
  /** Stable per marker (e.g. `van:1`, `item:12`), for tests and the debug hook. */
  readonly id: string;
  /** World pixels. */
  readonly x: number;
  readonly y: number;
  /** Overrides the style's colour (player / van colours). */
  readonly color?: string;
  /** Ours (own van, own position): drawn with a highlight ring. */
  readonly mine?: boolean;
}

// --- world snapshot ---------------------------------------------------------------------------------

export interface MinimapPlayer {
  readonly id: string;
  readonly color: string;
  /** 0-based van slot, -1 before the first round. */
  readonly van: number;
  /** 0 = no team. */
  readonly team: number;
  readonly joinOrder: number;
  readonly spectator: boolean;
  /** World item ids, 0 = none. */
  readonly target: number;
  readonly carrying: number;
  readonly x: number;
  readonly y: number;
}

export interface MinimapItem {
  readonly id: number;
  readonly state: string;
  readonly x: number;
  readonly y: number;
}

/** What the layers read: the synced state as plain data, plus the raw state for later layers. */
export interface MinimapWorld {
  readonly me: MinimapPlayer | null;
  /** Join order. */
  readonly players: readonly MinimapPlayer[];
  readonly items: readonly MinimapItem[];
  /** Van slots in use this round (keys of `state.vans`). */
  readonly vans: readonly number[];
  /** The room state as synced (null offline), for layers this module does not read yet. */
  readonly state: unknown;
}

/** Reads the minimap's part of the synced GameState (M3-4 schema), defensively like lobbyView. */
export function readMinimapWorld(state: unknown, mySessionId: string): MinimapWorld {
  const s = isBag(state) ? state : {};
  const players: MinimapPlayer[] = [];
  for (const [key, value] of mapEntries(s['players'])) {
    if (!isBag(value)) continue;
    players.push({
      id: str(value, 'sessionId', key) || key,
      color: str(value, 'color'),
      van: num(value, 'van', -1),
      team: num(value, 'team'),
      joinOrder: num(value, 'joinOrder'),
      spectator: value['spectator'] === true,
      target: num(value, 'target'),
      carrying: num(value, 'carrying'),
      x: num(value, 'x'),
      y: num(value, 'y'),
    });
  }
  players.sort((a, b) => a.joinOrder - b.joinOrder || a.id.localeCompare(b.id));

  const items: MinimapItem[] = [];
  for (const [key, value] of mapEntries(s['items'])) {
    if (!isBag(value)) continue;
    items.push({
      id: num(value, 'id', Number(key)),
      state: str(value, 'state'),
      x: num(value, 'x'),
      y: num(value, 'y'),
    });
  }

  const vans: number[] = [];
  for (const [key, value] of mapEntries(s['vans'])) {
    const van = isBag(value) ? num(value, 'van', Number(key)) : Number(key);
    if (Number.isInteger(van) && van >= 0) vans.push(van);
  }
  vans.sort((a, b) => a - b);

  return { me: players.find((p) => p.id === mySessionId) ?? null, players, items, vans, state };
}

/** The offline walk (`?scene=game`): just us at van slot 1, no items. */
export function offlineMinimapWorld(color: string, at: Vec): MinimapWorld {
  const me: MinimapPlayer = {
    id: 'offline',
    color,
    van: 0,
    team: 0,
    joinOrder: 0,
    spectator: false,
    target: 0,
    carrying: 0,
    x: at.x,
    y: at.y,
  };
  return { me, players: [me], items: [], vans: [0], state: null };
}

// --- layers -----------------------------------------------------------------------------------------

/** Static map data the layers may place markers on. */
export interface MinimapMap {
  /** 0-based van slot → van centre (MapModel.vanSlots). */
  readonly vanSlots: readonly Vec[];
}

export type MinimapLayer = (world: MinimapWorld, map: MinimapMap) => MinimapMarker[];

/** Vans in use, coloured like their first player (by join order); our own van is highlighted. */
export const vanLayer: MinimapLayer = (world, map) => {
  const vans = new Set(world.vans);
  if (world.me && world.me.van >= 0 && !world.me.spectator) vans.add(world.me.van);
  const out: MinimapMarker[] = [];
  for (const van of [...vans].sort((a, b) => a - b)) {
    const at = map.vanSlots[van];
    if (!at) continue;
    const mine = world.me !== null && !world.me.spectator && world.me.van === van;
    const owner = mine ? world.me : world.players.find((p) => p.van === van && !p.spectator);
    out.push({
      kind: 'van',
      id: `van:${van}`,
      x: at.x,
      y: at.y,
      ...(owner?.color ? { color: owner.color } : {}),
      ...(mine ? { mine: true } : {}),
    });
  }
  return out;
};

/** Items lying on the floor (dropped or stolen and dropped), except our target, which has its own marker. */
export const looseLayer: MinimapLayer = (world) => {
  const target = world.me?.target ?? 0;
  return world.items
    .filter((item) => item.state === 'loose' && item.id !== target)
    .map((item) => ({ kind: 'loose', id: `item:${item.id}`, x: item.x, y: item.y }));
};

/** Our target while it is not in someone's hands (a carried item is drawn at its carrier, not here). */
export const targetLayer: MinimapLayer = (world) => {
  const me = world.me;
  if (me === null || me.spectator || me.target === 0) return [];
  const item = world.items.find((i) => i.id === me.target);
  if (!item || item.state === 'carried') return [];
  return [{ kind: 'target', id: `item:${item.id}`, x: item.x, y: item.y }];
};

/** Forklifts driving their routes (§13.2), whatever their npcs.json id, keyed on the synced behaviour. */
export const forkliftLayer: MinimapLayer = (world) =>
  readNpcs(world.state)
    .filter((n) => n.behaviour === 'forklift')
    .map((n) => ({ kind: 'forklift', id: `npc:${n.id}`, x: n.x, y: n.y }));

/** Where we are. */
export const selfLayer: MinimapLayer = (world) => {
  const me = world.me;
  if (me === null || me.spectator) return [];
  return [
    { kind: 'self', id: 'self', x: me.x, y: me.y, ...(me.color ? { color: me.color } : {}), mine: true },
  ];
};

export const DEFAULT_LAYERS: readonly MinimapLayer[] = [
  vanLayer,
  looseLayer,
  forkliftLayer,
  targetLayer,
  selfLayer,
];

/** Every marker of every layer, sorted bottom to top (style z, then layer order). */
export function buildMinimapMarkers(
  world: MinimapWorld,
  map: MinimapMap,
  layers: readonly MinimapLayer[] = DEFAULT_LAYERS,
): MinimapMarker[] {
  const out = layers.flatMap((layer) => layer(world, map));
  return out
    .map((marker, i) => ({ marker, i }))
    .sort((a, b) => MARKER_STYLES[a.marker.kind].z - MARKER_STYLES[b.marker.kind].z || a.i - b.i)
    .map(({ marker }) => marker);
}

/** Moves our own marker to `at` (the predicted body, which runs ahead of the synced state). */
export function withSelfAt(world: MinimapWorld, at: Vec): MinimapWorld {
  if (world.me === null) return world;
  const me = { ...world.me, x: at.x, y: at.y };
  return { ...world, me, players: world.players.map((p) => (p.id === me.id ? me : p)) };
}
