// Where a round's NPCs start (§8, §15.4): how many of each type (count scaling) and which map object
// each one uses. Pure: the server calls `planNpcs` at round start and `checkNpcMap` when it loads a map.
import type { NpcSpawn, NpcWaypoint, ForkliftRoute, Zone } from '../map/mapModel';
import type { Vec2 } from '../types';
import { npcCount, type NpcBehaviour, type NpcCatalogue } from './catalogue';

/** What NPC placement needs from a map. `MapModel` satisfies this shape. */
export interface NpcMap {
  readonly npcSpawns: readonly NpcSpawn[];
  readonly npcWaypoints: readonly NpcWaypoint[];
  readonly forkliftRoutes: readonly ForkliftRoute[];
  readonly zones: readonly Zone[];
}

/** One NPC of a round and where it starts. Respawns (§8, 30 s) go back to the same `spawn`. */
export interface NpcPlacement {
  /** Stable id for the round: `<type>_<n>`, n from 1 in placement order (e.g. `security_2`). */
  readonly key: string;
  /** NPC type id from npcs.json. */
  readonly type: string;
  readonly behaviour: NpcBehaviour;
  /** Start and respawn position in pixels. Forklifts start at their route's first point. */
  readonly spawn: Vec2;
  /**
   * True when this NPC stands guard at `spawn` instead of walking. Only the first NPC at a `post`
   * spawn gets it; extra NPCs that share the spawn (more NPCs than spawns) walk instead.
   */
  readonly post: boolean;
  /** Forklifts: index into `map.forkliftRoutes`. Null for everyone else. */
  readonly routeIndex: number | null;
}

/** Behaviours that walk between `npc_waypoints` when they are not on a post. */
const WANDERERS: readonly NpcBehaviour[] = ['stocker', 'security'];

/**
 * The NPCs for a round with `players` players (spectators do not count), in catalogue order and then
 * in map order. Spawn-based types cycle through their `npc_spawns` of that type when the count is
 * higher than the number of spawns (the server should nudge stacked NPCs apart with `findSpawn`).
 * Forklifts take one `forklift_routes` polyline each, so their count is capped at the number of routes.
 * A type with no spawn points (or routes) on the map gets none; `checkNpcMap` reports that.
 */
export function planNpcs(catalogue: NpcCatalogue, map: NpcMap, players: number): NpcPlacement[] {
  const out: NpcPlacement[] = [];
  for (const def of catalogue.npcs) {
    const wanted = npcCount(def.count, players);
    if (def.behaviour === 'forklift') {
      const n = Math.min(wanted, map.forkliftRoutes.length);
      for (let i = 0; i < n; i++) {
        const first = (map.forkliftRoutes[i] as ForkliftRoute).points[0] as Vec2;
        out.push({
          key: `${def.id}_${i + 1}`,
          type: def.id,
          behaviour: def.behaviour,
          spawn: { x: first.x, y: first.y },
          post: false,
          routeIndex: i,
        });
      }
      continue;
    }
    const spawns = map.npcSpawns.filter((s) => s.type === def.id);
    if (spawns.length === 0) continue;
    for (let i = 0; i < wanted; i++) {
      const spawn = spawns[i % spawns.length] as NpcSpawn;
      out.push({
        key: `${def.id}_${i + 1}`,
        type: def.id,
        behaviour: def.behaviour,
        spawn: { x: spawn.x, y: spawn.y },
        post: spawn.post && i < spawns.length,
        routeIndex: null,
      });
    }
  }
  return out;
}

/**
 * The NPC types a map has (Phase 2 decision 7), in catalogue order: types with `npc_spawns` on the map,
 * and forklifts when it has `forklift_routes`. Other types are simply absent from that map.
 */
export function npcRoster(catalogue: NpcCatalogue, map: NpcMap): string[] {
  return catalogue.npcs
    .filter((def) =>
      def.behaviour === 'forklift'
        ? map.forkliftRoutes.length > 0
        : map.npcSpawns.some((s) => s.type === def.id),
    )
    .map((def) => def.id);
}

/**
 * Checks that a map has what each NPC type it spawns needs (§15.4): spawns of known types, at least two
 * waypoints for walkers, the butcher's zones, and `post` only on guards. Types the map has no spawns
 * (or, for forklifts, routes) for are absent from it and not checked (`npcRoster`). Returns the
 * problems, one per line; empty when the map is fine. The server refuses to start on problems, like it
 * does for invalid data.
 */
export function checkNpcMap(catalogue: NpcCatalogue, map: NpcMap): string[] {
  const issues: string[] = [];
  const zoneIds = new Set(map.zones.map((z) => z.id));
  map.npcSpawns.forEach((s, i) => {
    const where = `npc_spawns[${i}] (${s.type} at ${s.x},${s.y})`;
    const def = catalogue.get(s.type);
    if (def === undefined) {
      issues.push(`${where}: unknown NPC type "${s.type}" (not in npcs.json)`);
      return;
    }
    if (def.behaviour === 'forklift') {
      issues.push(`${where}: forklifts start on forklift_routes, not npc_spawns`);
    }
    if (s.post && def.behaviour !== 'security') {
      issues.push(`${where}: "post" is only used by security guards`);
    }
  });
  const roster = new Set(npcRoster(catalogue, map));
  for (const def of catalogue.npcs) {
    if (def.behaviour === 'forklift' || !roster.has(def.id)) continue;
    const spawns = map.npcSpawns.filter((s) => s.type === def.id);
    const walks = WANDERERS.includes(def.behaviour) && spawns.some((s) => !s.post);
    if (walks && map.npcWaypoints.length < 2) {
      issues.push(`${def.id}: walks between npc_waypoints but the map has ${map.npcWaypoints.length}`);
    }
    if (def.behaviour === 'butcher') {
      for (const zone of [def.guardZone, def.homeZone]) {
        if (!zoneIds.has(zone)) issues.push(`${def.id}: zone "${zone}" is not in the map's zones layer`);
      }
    }
  }
  return issues;
}
