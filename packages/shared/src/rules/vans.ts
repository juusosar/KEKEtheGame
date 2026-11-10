// Van slots and reach checks (§3, §4.3, §9.1, §15.3). Pure: the server calls these with the roster,
// the map's van slots and body positions; tests replay them without a room.
import type { GameConfig } from '../config';
import type { Vec2 } from '../types';

/** One player for van assignment. `van` is the slot they held before (-1 or absent for none). */
export interface VanRosterEntry {
  readonly id: string;
  readonly joinOrder: number;
  /** 0 = no team, 1 or 2 = team. */
  readonly team: number;
  readonly van?: number | undefined;
}

export interface VanAssignmentOptions {
  /** Teams option on: a team shares one van and teams use the first slots (§4.3, §9.1). */
  readonly teams: boolean;
  /** Van slots on the map. */
  readonly slotCount: number;
}

/**
 * Van slot (0-based, slot index i = map van `index` i + 1) for every player. Deterministic for the same
 * roster and options:
 * - Teams on: team 1 gets slot 0, team 2 slot 1. A teamless player gets a slot of their own after those.
 * - Otherwise each player keeps the slot they held before when it is still free, so a player who
 *   reconnects or plays the next round stays at the same van (§15.3). Everyone else takes the lowest
 *   free slot, in join order (§9.1 "assigned in join order").
 * With more players than slots, the extra players share slots (join order modulo the slot count).
 * A map without van slots puts everyone at slot 0.
 */
export function assignVans(
  roster: Iterable<VanRosterEntry>,
  options: VanAssignmentOptions,
): Map<string, number> {
  const players = [...roster].sort((a, b) => a.joinOrder - b.joinOrder || compareIds(a.id, b.id));
  const result = new Map<string, number>();
  const count = Math.max(0, Math.floor(options.slotCount));
  if (count === 0) {
    for (const p of players) result.set(p.id, 0);
    return result;
  }

  const taken = new Set<number>();
  const solo: VanRosterEntry[] = [];
  for (const p of players) {
    if (options.teams && (p.team === 1 || p.team === 2)) {
      const slot = Math.min(p.team - 1, count - 1);
      result.set(p.id, slot);
      taken.add(slot);
    } else {
      solo.push(p);
    }
  }
  const firstFree = options.teams ? Math.min(2, count) : 0;
  const needSlot: VanRosterEntry[] = [];
  for (const p of solo) {
    const prev = p.van;
    if (
      prev !== undefined &&
      Number.isInteger(prev) &&
      prev >= firstFree &&
      prev < count &&
      !taken.has(prev)
    ) {
      result.set(p.id, prev);
      taken.add(prev);
    } else {
      needSlot.push(p);
    }
  }
  let next = firstFree;
  needSlot.forEach((p, i) => {
    while (next < count && taken.has(next)) next++;
    if (next < count) {
      result.set(p.id, next);
      taken.add(next);
    } else {
      result.set(p.id, (firstFree + i) % count);
    }
  });
  return result;
}

/** Centre of van slot `van` (0-based) on a map, or undefined when the map has no such slot. */
export function vanCentre(vanSlots: readonly Vec2[], van: number): Vec2 | undefined {
  return vanSlots[van];
}

/** The config keys reach checks read. */
export type ReachConfig = Pick<GameConfig, 'tileSize' | 'pickupRangeTiles' | 'depositRangeTiles'>;

/** True when a body at `pos` is close enough to pick up an item lying at `item` (§13.3 interact). */
export function inPickupRange(pos: Vec2, item: Vec2, config: ReachConfig): boolean {
  return Math.hypot(pos.x - item.x, pos.y - item.y) <= config.pickupRangeTiles * config.tileSize;
}

/** True when a body at `pos` is at the van centred on `van`, close enough to deposit (§3 step 5). */
export function inDepositRange(pos: Vec2, van: Vec2, config: ReachConfig): boolean {
  return Math.hypot(pos.x - van.x, pos.y - van.y) <= config.depositRangeTiles * config.tileSize;
}

/**
 * The item a player at `pos` picks up: the nearest one in pickup range, ties broken by the lower id.
 * `items` are the candidates (lying items, not carried ones). Undefined when none is in range.
 */
export function nearestInReach<T extends Vec2 & { readonly id: number }>(
  pos: Vec2,
  items: Iterable<T>,
  config: ReachConfig,
): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    if (!inPickupRange(pos, item, config)) continue;
    const dist = Math.hypot(pos.x - item.x, pos.y - item.y);
    if (dist < bestDist || (dist === bestDist && best !== undefined && item.id < best.id)) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
