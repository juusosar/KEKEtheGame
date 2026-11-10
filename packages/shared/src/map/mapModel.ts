// Tiled .tmj → MapModel (§15.4). Used by the server (collision, spawns, zones) and the client.
// Pure: takes already-parsed JSON, never touches the file system.
import type { z } from 'zod';
import { formatIssues } from '../config';
import type { Vec2 } from '../types';
import { boundsOf, pointInPolygon, polygonArea, type Bounds } from './geometry';
import {
  tiledLayerSchema,
  tiledMapSchema,
  type TiledObject,
  type TiledObjectLayer,
  type TiledTileLayer,
} from './tiled';

/** Tile layers every map must have (§15.4). Only `walls` affects the rules; the rest are for rendering. */
export const TILE_LAYERS = ['ground', 'walls', 'decor', 'above'] as const;

/** Object layers every map must have (§15.4). */
export const OBJECT_LAYERS = [
  'van_slots',
  'item_spawns',
  'npc_spawns',
  'npc_waypoints',
  'forklift_routes',
  'zones',
  'office_trigger',
] as const;

/** Tiled stores flip/rotation flags in the top 4 bits of a gid. */
const GID_FLAG_MASK = 0x0fffffff;

/** Tile collision grid built from the `walls` layer. Coordinates are tile indices. */
export interface MapCollisionGrid {
  readonly width: number;
  readonly height: number;
  /** Tile size in pixels (tiles are square). */
  readonly tileSize: number;
  /** One byte per tile, row-major: 1 = solid. */
  readonly solid: Uint8Array;
  /** True for wall tiles and for anything outside the map. */
  isSolid(tx: number, ty: number): boolean;
}

/** A named map region from the `zones` layer (§9.1). */
export interface Zone {
  readonly id: string;
  /** Absolute polygon vertices in pixels. */
  readonly polygon: readonly Vec2[];
  readonly bounds: Bounds;
  readonly area: number;
  /** Velocity retained per tick on this floor. Undefined = normal floor. */
  readonly friction?: number;
  /** Movement speed multiplier inside the zone. Undefined = 1. */
  readonly speedMultiplier?: number;
  /** Entering makes the player Wanted (e.g. staff_only). */
  readonly wantedOnEnter: boolean;
}

export interface VanSlot {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

export interface ItemSpawn {
  readonly x: number;
  readonly y: number;
  /** Zone id the spawn belongs to (matches `Item.zone` in the catalogue). */
  readonly zone: string;
}

export interface NpcSpawn {
  readonly x: number;
  readonly y: number;
  /** NPC type id from npcs.json, e.g. `stocker`. */
  readonly type: string;
}

export interface NpcWaypoint {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

export interface ForkliftRoute {
  readonly id: number;
  readonly name: string;
  /** Absolute route vertices in pixels; the forklift loops back from the last to the first. */
  readonly points: readonly Vec2[];
}

export interface OfficeTrigger {
  readonly polygon: readonly Vec2[];
  readonly bounds: Bounds;
}

/** Everything the rules need from a map. Positions are in pixels unless stated otherwise. */
export interface MapModel {
  /** Size in tiles. */
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** Size in pixels. */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly collision: MapCollisionGrid;
  /** Zones in layer order. */
  readonly zones: readonly Zone[];
  /** Sorted by `index`. */
  readonly vanSlots: readonly VanSlot[];
  readonly itemSpawns: readonly ItemSpawn[];
  readonly npcSpawns: readonly NpcSpawn[];
  readonly npcWaypoints: readonly NpcWaypoint[];
  readonly forkliftRoutes: readonly ForkliftRoute[];
  readonly officeTrigger: OfficeTrigger;
  /** The zone at a pixel position, the smallest one where zones nest. See `zoneAt`. */
  zoneAt(x: number, y: number): Zone | undefined;
}

/** Thrown by `loadMap` when the map is invalid. The message lists every problem, one per line. */
export class MapError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`Invalid map ${source}:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'MapError';
    this.issues = issues;
  }
}

/**
 * Returns the zone containing pixel position (x, y), or undefined when it is in no zone.
 * Where zones overlap (e.g. `behind_counter` inside `meat_fish`) the smallest one wins;
 * equal areas fall back to layer order.
 */
export function zoneAt(zones: readonly Zone[], x: number, y: number): Zone | undefined {
  let best: Zone | undefined;
  for (const zone of zones) {
    const b = zone.bounds;
    if (x < b.minX || x >= b.maxX || y < b.minY || y >= b.maxY) continue;
    if (!pointInPolygon(x, y, zone.polygon)) continue;
    if (best === undefined || zone.area < best.area) best = zone;
  }
  return best;
}

/** Every zone containing (x, y), smallest first. */
export function zonesAt(zones: readonly Zone[], x: number, y: number): Zone[] {
  return zones.filter((z) => pointInPolygon(x, y, z.polygon)).sort((a, b) => a.area - b.area);
}

/**
 * Validates a parsed Tiled map (.tmj JSON) and builds the MapModel.
 * Throws `MapError` listing every problem (missing layers, bad properties, …) at once.
 */
export function loadMap(raw: unknown, source = 'map'): MapModel {
  const issues: string[] = [];
  const fail = (): never => {
    throw new MapError(source, issues);
  };

  const parsedMap = tiledMapSchema.safeParse(raw);
  if (!parsedMap.success) {
    issues.push(...formatIssues(parsedMap.error));
    return fail();
  }
  const map = parsedMap.data;
  if (map.tilewidth !== map.tileheight) {
    issues.push(`tiles must be square, got ${map.tilewidth}x${map.tileheight}`);
  }

  // Flatten group layers and validate every layer.
  const tileLayers = new Map<string, TiledTileLayer>();
  const objectLayers = new Map<string, TiledObjectLayer>();
  const visit = (layers: readonly unknown[], path: string): void => {
    layers.forEach((rawLayer, i) => {
      if (isBase64TileLayer(rawLayer)) {
        issues.push(
          `${path}[${i}] ("${rawLayer.name}"): tile data must use CSV encoding (Map Properties > Tile Layer Format)`,
        );
        return;
      }
      const parsed = tiledLayerSchema.safeParse(rawLayer);
      if (!parsed.success) {
        issues.push(...prefixed(`${path}[${i}]`, parsed.error));
        return;
      }
      const layer = parsed.data;
      if (layer.type === 'group') {
        visit(layer.layers, `${path}[${i}].layers`);
        return;
      }
      if (layer.type === 'imagelayer') return;
      if (tileLayers.has(layer.name) || objectLayers.has(layer.name)) {
        issues.push(`layer "${layer.name}" appears more than once`);
      } else if (layer.type === 'tilelayer') {
        tileLayers.set(layer.name, layer);
      } else {
        objectLayers.set(layer.name, layer);
      }
    });
  };
  visit(map.layers, 'layers');

  for (const name of TILE_LAYERS) {
    const layer = tileLayers.get(name);
    if (layer === undefined) {
      issues.push(
        objectLayers.has(name) ? `layer "${name}" must be a tile layer` : `missing tile layer "${name}"`,
      );
    } else if (layer.width !== map.width || layer.height !== map.height) {
      issues.push(
        `tile layer "${name}" is ${layer.width}x${layer.height}, map is ${map.width}x${map.height}`,
      );
    } else if (layer.data.length !== map.width * map.height) {
      issues.push(`tile layer "${name}" has ${layer.data.length} tiles, expected ${map.width * map.height}`);
    }
  }
  for (const name of OBJECT_LAYERS) {
    if (!objectLayers.has(name)) {
      issues.push(
        tileLayers.has(name) ? `layer "${name}" must be an object layer` : `missing object layer "${name}"`,
      );
    }
  }
  if (issues.length > 0) return fail();

  const objects = (name: (typeof OBJECT_LAYERS)[number]): readonly TiledObject[] =>
    (objectLayers.get(name) as TiledObjectLayer).objects;
  const ctx = new ObjectReader(issues);

  const zones = objects('zones').flatMap((o) => {
    const where = `zones #${o.id}`;
    const polygon = ctx.area(o, where);
    const id = ctx.string(o, 'id', where) ?? (o.name !== '' ? o.name : undefined);
    if (id === undefined) issues.push(`${where}: needs an "id" property or a name`);
    const friction = ctx.optionalNumber(o, 'friction', where);
    const speedMultiplier = ctx.optionalNumber(o, 'speedMultiplier', where);
    const wantedOnEnter = ctx.optionalBoolean(o, 'wantedOnEnter', where) ?? false;
    if (friction !== undefined && (friction < 0 || friction > 1)) {
      issues.push(`${where}: friction must be between 0 and 1, got ${friction}`);
    }
    if (speedMultiplier !== undefined && speedMultiplier <= 0) {
      issues.push(`${where}: speedMultiplier must be positive, got ${speedMultiplier}`);
    }
    if (polygon === undefined || id === undefined) return [];
    const zone: Zone = {
      id,
      polygon,
      bounds: boundsOf(polygon),
      area: polygonArea(polygon),
      wantedOnEnter,
      ...(friction !== undefined && { friction }),
      ...(speedMultiplier !== undefined && { speedMultiplier }),
    };
    return [zone];
  });
  const zoneIds = new Set<string>();
  for (const zone of zones) {
    if (zoneIds.has(zone.id)) issues.push(`zones: duplicate zone id "${zone.id}"`);
    zoneIds.add(zone.id);
  }

  const vanSlots = objects('van_slots')
    .flatMap((o) => {
      const where = `van_slots #${o.id}`;
      const pos = ctx.point(o, where);
      const index = ctx.int(o, 'index', where);
      return pos === undefined || index === undefined ? [] : [{ index, ...pos }];
    })
    .sort((a, b) => a.index - b.index);
  vanSlots.forEach((slot, i) => {
    if (slot.index === vanSlots[i - 1]?.index) issues.push(`van_slots: duplicate index ${slot.index}`);
  });

  const itemSpawns = objects('item_spawns').flatMap((o) => {
    const where = `item_spawns #${o.id}`;
    const pos = ctx.point(o, where);
    const zone = ctx.string(o, 'zone', where);
    if (zone === undefined) {
      issues.push(`${where}: missing "zone" property`);
    } else if (!zoneIds.has(zone)) {
      issues.push(`${where}: zone "${zone}" is not in the zones layer`);
    }
    return pos === undefined || zone === undefined ? [] : [{ ...pos, zone }];
  });

  const npcSpawns = objects('npc_spawns').flatMap((o) => {
    const where = `npc_spawns #${o.id}`;
    const pos = ctx.point(o, where);
    const type = ctx.string(o, 'type', where) ?? nonEmpty(o.type) ?? nonEmpty(o.class);
    if (type === undefined) issues.push(`${where}: needs a "type" property or class`);
    return pos === undefined || type === undefined ? [] : [{ ...pos, type }];
  });

  const npcWaypoints = objects('npc_waypoints').flatMap((o) => {
    const pos = ctx.point(o, `npc_waypoints #${o.id}`);
    return pos === undefined ? [] : [{ id: o.id, name: o.name, ...pos }];
  });

  const forkliftRoutes = objects('forklift_routes').flatMap((o) => {
    const where = `forklift_routes #${o.id}`;
    ctx.unrotated(o, where);
    const vertices = o.polyline ?? o.polygon;
    if (vertices === undefined || vertices.length < 2) {
      issues.push(`${where}: must be a polyline with at least 2 points`);
      return [];
    }
    return [{ id: o.id, name: o.name, points: vertices.map((p) => ({ x: o.x + p.x, y: o.y + p.y })) }];
  });

  const triggers = objects('office_trigger');
  if (triggers.length !== 1) {
    issues.push(`office_trigger: expected exactly 1 object, found ${triggers.length}`);
  }
  const first = triggers[0];
  const triggerPolygon = first === undefined ? undefined : ctx.area(first, `office_trigger #${first.id}`);

  if (issues.length > 0 || triggerPolygon === undefined) return fail();

  const collision = buildCollisionGrid(tileLayers.get('walls') as TiledTileLayer, map.tilewidth);
  return {
    width: map.width,
    height: map.height,
    tileSize: map.tilewidth,
    widthPx: map.width * map.tilewidth,
    heightPx: map.height * map.tileheight,
    collision,
    zones,
    vanSlots,
    itemSpawns,
    npcSpawns,
    npcWaypoints,
    forkliftRoutes,
    officeTrigger: { polygon: triggerPolygon, bounds: boundsOf(triggerPolygon) },
    zoneAt: (x, y) => zoneAt(zones, x, y),
  };
}

/** True when pixel position (x, y) is inside the office trigger (race-mode delivery). */
export function inOfficeTrigger(map: MapModel, x: number, y: number): boolean {
  return pointInPolygon(x, y, map.officeTrigger.polygon);
}

function buildCollisionGrid(walls: TiledTileLayer, tileSize: number): MapCollisionGrid {
  const { width, height } = walls;
  const solid = Uint8Array.from(walls.data, (gid) => ((gid & GID_FLAG_MASK) !== 0 ? 1 : 0));
  return {
    width,
    height,
    tileSize,
    solid,
    isSolid(tx, ty) {
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return true;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
      return solid[ty * width + tx] === 1;
    },
  };
}

/** Reads typed custom properties and shapes from Tiled objects, collecting problems into `issues`. */
class ObjectReader {
  constructor(private readonly issues: string[]) {}

  private value(o: TiledObject, name: string): unknown {
    return o.properties?.find((p) => p.name === name)?.value;
  }

  string(o: TiledObject, name: string, where: string): string | undefined {
    const v = this.value(o, name);
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v === '') {
      this.issues.push(`${where}: property "${name}" must be a non-empty string`);
      return undefined;
    }
    return v;
  }

  optionalNumber(o: TiledObject, name: string, where: string): number | undefined {
    const v = this.value(o, name);
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.issues.push(`${where}: property "${name}" must be a number`);
      return undefined;
    }
    return v;
  }

  int(o: TiledObject, name: string, where: string): number | undefined {
    const v = this.value(o, name);
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      this.issues.push(`${where}: property "${name}" must be a non-negative integer`);
      return undefined;
    }
    return v;
  }

  optionalBoolean(o: TiledObject, name: string, where: string): boolean | undefined {
    const v = this.value(o, name);
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') {
      this.issues.push(`${where}: property "${name}" must be a boolean`);
      return undefined;
    }
    return v;
  }

  unrotated(o: TiledObject, where: string): void {
    if (o.rotation !== 0) this.issues.push(`${where}: rotated objects are not supported`);
  }

  /** A point object (rectangles of size 0 count too, Tiled's older point format). */
  point(o: TiledObject, where: string): Vec2 | undefined {
    const isPoint = o.point === true || (o.width === 0 && o.height === 0 && !o.polygon && !o.polyline);
    if (!isPoint) {
      this.issues.push(`${where}: must be a point object`);
      return undefined;
    }
    return { x: o.x, y: o.y };
  }

  /** A polygon or rectangle object as absolute vertices. */
  area(o: TiledObject, where: string): Vec2[] | undefined {
    this.unrotated(o, where);
    if (o.polygon !== undefined) {
      if (o.polygon.length < 3) {
        this.issues.push(`${where}: polygon needs at least 3 points`);
        return undefined;
      }
      return o.polygon.map((p) => ({ x: o.x + p.x, y: o.y + p.y }));
    }
    if (o.point !== true && o.ellipse !== true && !o.polyline && o.width > 0 && o.height > 0) {
      const { x, y, width: w, height: h } = o;
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    }
    this.issues.push(`${where}: must be a polygon or rectangle`);
    return undefined;
  }
}

function nonEmpty(s: string | undefined): string | undefined {
  return s === undefined || s === '' ? undefined : s;
}

function prefixed(path: string, error: z.ZodError): string[] {
  return formatIssues(error).map((line) => `${path}.${line}`);
}

function isBase64TileLayer(raw: unknown): raw is { name: string } {
  if (typeof raw !== 'object' || raw === null) return false;
  const layer = raw as Record<string, unknown>;
  return layer['type'] === 'tilelayer' && layer['encoding'] === 'base64' && typeof layer['name'] === 'string';
}
