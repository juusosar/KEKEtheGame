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
  /** Teams option on: a team shares one van, at the map's team slots (§4.3, §9.1). */
  readonly teams: boolean;
  /** Van slots on the map. */
  readonly slotCount: number;
  /**
   * Slots (0-based) of team 1's and team 2's van: the map's `teamVanSlots` (P1 review F3). Default: the
   * first two slots.
   */
  readonly teamSlots?: readonly [number, number];
}

/**
 * Van slot (0-based, slot index i = map van `index` i + 1) for every player. Deterministic for the same
 * roster and options:
 * - Teams on: team 1 gets `teamSlots[0]`, team 2 `teamSlots[1]` (default slots 0 and 1). A teamless
 *   player gets a slot of their own among the others.
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

  // Team vans are reserved with Teams on, whether or not a team has players: nobody else parks there.
  const teamSlots = (options.teamSlots ?? [0, 1]).map((s) => Math.min(Math.max(0, Math.floor(s)), count - 1));
  const reserved = new Set<number>(options.teams ? teamSlots : []);
  // Slots for everyone else, lowest first; when they run out, players share them in this order and then
  // the team slots (the order the first-two-slots rule always used).
  const open = Array.from({ length: count }, (_, i) => i).filter((i) => !reserved.has(i));
  const overflow = [...open, ...[...reserved].sort((a, b) => a - b)];

  const taken = new Set<number>();
  const solo: VanRosterEntry[] = [];
  for (const p of players) {
    if (options.teams && (p.team === 1 || p.team === 2)) {
      const slot = teamSlots[p.team - 1] ?? 0;
      result.set(p.id, slot);
      taken.add(slot);
    } else {
      solo.push(p);
    }
  }
  const needSlot: VanRosterEntry[] = [];
  for (const p of solo) {
    const prev = p.van;
    if (
      prev !== undefined &&
      Number.isInteger(prev) &&
      prev >= 0 &&
      prev < count &&
      !reserved.has(prev) &&
      !taken.has(prev)
    ) {
      result.set(p.id, prev);
      taken.add(prev);
    } else {
      needSlot.push(p);
    }
  }
  let next = 0;
  needSlot.forEach((p, i) => {
    while (next < open.length && taken.has(open[next] ?? -1)) next++;
    const slot = open[next];
    if (slot !== undefined) {
      result.set(p.id, slot);
      taken.add(slot);
    } else {
      result.set(p.id, overflow[i % overflow.length] ?? 0);
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
