// Floor hazards (Phase 2 decision 10, P2-2): a zone with `damagePerSecond` (the bakery oven) burns
// whoever stands in it, one burn every `hazardTickSeconds`. Pure: the server keeps the clock and lands each
// burn through the combat damage path (KO, item drop, respawn). A burn has a `hazard` source, so team rules
// never stop it and it never makes anyone Wanted.
import { pointInPolygon } from '../map/geometry';
import type { Zone } from '../map/mapModel';

/** Seconds of slack when comparing round clock times built from repeated tick steps. */
const CLOCK_SLACK = 1e-6;

export interface HazardBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface HazardBurn {
  readonly target: string;
  /** Id of the hazard zone, e.g. `oven`; the hit's source is `{ kind: 'hazard', id: zone }`. */
  readonly zone: string;
  readonly damage: number;
}

/** When each player may next be burnt (round seconds). Kept after leaving, so stepping out and back in never burns faster. */
export type HazardClock = ReadonlyMap<string, number>;

export interface HazardResult {
  readonly clock: HazardClock;
  readonly burns: readonly HazardBurn[];
}

/** The zones of a map that hurt, in layer order. */
export function hazardZones(zones: readonly Zone[]): Zone[] {
  return zones.filter((z) => z.damagePerSecond !== undefined && z.damagePerSecond > 0);
}

/**
 * The hazard zone at (x, y), or undefined. Where hazard zones overlap the one that hurts most wins, so the
 * burn rate never depends on layer order.
 */
export function hazardAt(hazards: readonly Zone[], x: number, y: number): Zone | undefined {
  let best: Zone | undefined;
  for (const zone of hazards) {
    const b = zone.bounds;
    if (x < b.minX || x >= b.maxX || y < b.minY || y >= b.maxY) continue;
    if (!pointInPolygon(x, y, zone.polygon)) continue;
    if (best === undefined || (zone.damagePerSecond ?? 0) > (best.damagePerSecond ?? 0)) best = zone;
  }
  return best;
}

/**
 * One server tick of floor hazards. A body standing in a hazard zone is burnt for
 * `damagePerSecond × tickSeconds` as soon as its clock allows (at once on entering), then not again for
 * `tickSeconds`. Pass only bodies that can be burnt (round players, alive, online); the combat rules still
 * refuse spawn-protected ones. Clock entries that ran out are dropped.
 */
export function hazardTick(
  clock: HazardClock,
  hazards: readonly Zone[],
  bodies: Iterable<HazardBody>,
  now: number,
  tickSeconds: number,
): HazardResult {
  const next = new Map<string, number>();
  for (const [id, at] of clock) if (at > now + CLOCK_SLACK) next.set(id, at);
  const burns: HazardBurn[] = [];
  if (hazards.length === 0 || !(tickSeconds > 0)) return { clock: next, burns };
  for (const body of bodies) {
    const zone = hazardAt(hazards, body.x, body.y);
    if (!zone || next.has(body.id)) continue;
    burns.push({ target: body.id, zone: zone.id, damage: (zone.damagePerSecond ?? 0) * tickSeconds });
    next.set(body.id, now + tickSeconds);
  }
  return { clock: next, burns };
}
