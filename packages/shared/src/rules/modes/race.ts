// Quota + Race mode (§4.2). Pure and immutable like carry.ts: every operation takes an `ItemWorld` and
// returns a new one plus the events it caused. The order box is an ordinary `WorldItem` with `box` set,
// so the carry rules already cover most of §4.2: a box is picked up with `pickup` (kind 'box'), drops on
// KO / slip / forklift / disconnect with `drop`, is pushed by `moveLyingItems`, cannot be deposited
// (`deposit` refuses it) and never despawns. A player carrying a box carries something, so they cannot
// pick up items and get no new target (§3.1, §3.2). This module adds what only race mode has:
//
//   collecting ──deposit reaches quota──▶ box packed, auto-picked up by the depositor (van back to 0)
//   box carried ──drop (KO, slip, forklift, Q, leave)──▶ box lying ──pickup by anyone──▶ box carried
//   box carried ──carrier enters the office trigger──▶ delivery: the deliverer wins, the round ends
//   no delivery by `raceRoundSeconds` (240 s) ──▶ ranking by "items you control"
//
// The state machine is derived from the world (where each box is, who carries it, van totals), so the
// server mirrors only the ItemWorld plus the single winning delivery. A van is the scoring side: one per
// player in free-for-all, one per team with Teams on (§4.3), so quota, box and count are per van.
// Range checks (at the van, inside the office trigger) stay the server's job, like in carry.ts.
import type { GameConfig } from '../../config';
import type { Vec2 } from '../../types';
import {
  deposit,
  findCarryPlayer,
  findItem,
  vanPointsOf,
  type CarryRejection,
  type ItemEvent,
  type ItemWorld,
  type OrderBox,
  type WorldItem,
} from '../carry';
import {
  rankByItemPoints,
  teamSideId,
  type PlayerPlacement,
  type Ranked,
  type TimedPlayerScore,
} from './timed';

export type { OrderBox } from '../carry';

/** `WorldItem.itemId` of an order box. Never a catalogue id (catalogue ids are checked against it). */
export const ORDER_BOX_ITEM_ID = 'order_box';

export type RaceConfig = Pick<GameConfig, 'raceQuota' | 'jokeItemValue'>;

/**
 * The quota of a van shared by `sideSize` round players (playtest 1): `raceQuota`, or
 * `raceTeamQuotaPerMember` per player when that is more, so a team of 4 pooling one van needs 12, not 6
 * (Race + Teams was over in 70 to 110 s). Free-for-all (one player a van) keeps `raceQuota`. At most 255.
 */
export function raceQuotaFor(
  config: Pick<GameConfig, 'raceQuota' | 'raceTeamQuotaPerMember'>,
  sideSize: number,
): number {
  return Math.min(255, Math.max(config.raceQuota, config.raceTeamQuotaPerMember * Math.max(1, sideSize)));
}

/** The delivery that won the round. The server keeps the first one and ends 'playing' (§4.2). */
export interface RaceDelivery {
  /** The player who carried the box into the office: they (their team) win. */
  readonly player: string;
  /** The deliverer's van (their side), not necessarily the van that packed the box. */
  readonly van: number;
  /** The delivered box as it was carried (its `box.van` is the packer's van). */
  readonly box: WorldItem & { readonly box: OrderBox };
  /** Round time (s) of the delivery. */
  readonly at: number;
}

export type RaceEvent =
  /** A deposit reached the quota: the van's items were packed and `player` now carries the box. */
  | {
      readonly type: 'boxPacked';
      readonly player: string;
      readonly van: number;
      readonly box: WorldItem & { readonly box: OrderBox };
    }
  /** A box carrier entered the office trigger. `stolen`: the box was packed by another van. */
  | {
      readonly type: 'delivery';
      readonly player: string;
      readonly van: number;
      readonly box: WorldItem & { readonly box: OrderBox };
      readonly stolen: boolean;
    };

export type RaceRejection = CarryRejection | 'not_carrying_box';

export interface RaceResult {
  readonly world: ItemWorld;
  /** Item events first (e.g. the `deposit`), then race events (`boxPacked`), in the order they happened. */
  readonly events: readonly (ItemEvent | RaceEvent)[];
  readonly rejected?: RaceRejection;
  /** Set by `deliver` when it succeeds. */
  readonly delivery?: RaceDelivery;
}

/** True for an order box (any state). */
export function isOrderBox(item: WorldItem): item is WorldItem & { readonly box: OrderBox } {
  return item.box !== undefined;
}

/** Every order box in the world: lying or carried. */
export function orderBoxes(world: ItemWorld): (WorldItem & { readonly box: OrderBox })[] {
  return world.items.filter(isOrderBox);
}

/** The box `playerId` carries, or undefined (not carrying, or carrying a normal item). */
export function carriedBox(
  world: ItemWorld,
  playerId: string,
): (WorldItem & { readonly box: OrderBox }) | undefined {
  const carrying = findCarryPlayer(world, playerId)?.carrying;
  const item = carrying != null ? findItem(world, carrying) : undefined;
  return item && isOrderBox(item) ? item : undefined;
}

/** True while the player carries an order box: the minimap marks them for everyone (§4.2). */
export function isCarryingBox(world: ItemWorld, playerId: string): boolean {
  return carriedBox(world, playerId) !== undefined;
}

/** A van's progress towards the next box: its banked points (back to 0 after each packing) and the quota. */
export function quotaProgress(
  world: ItemWorld,
  van: number,
  config: Pick<GameConfig, 'raceQuota'>,
): { readonly points: number; readonly quota: number } {
  return { points: vanPointsOf(world, van), quota: config.raceQuota };
}

/**
 * Race-mode deposit (§4.2): the normal deposit (§3 step 5), then, when the van's banked points reach
 * `raceQuota`, the van's items are packed into an order box worth all of them, the van goes back to 0
 * and the depositor (who is at the van, so nothing else is needed) carries the box. A joke item can
 * push the box over the quota (6 → 7 points). A van packs a new box every time it reaches the quota
 * again, e.g. after its first box was stolen. `pos` is the depositor's position: the box's pickup spot.
 * Refuses an order box (`box_not_depositable`) like `deposit` does.
 */
export function raceDeposit(world: ItemWorld, playerId: string, pos: Vec2, config: RaceConfig): RaceResult {
  const deposited = deposit(world, playerId, config);
  if (deposited.rejected) return deposited;
  const player = findCarryPlayer(deposited.world, playerId);
  if (!player) return deposited;
  const banked = vanPointsOf(deposited.world, player.van);
  if (banked < config.raceQuota) return deposited;
  const box = {
    id: deposited.world.nextItemId,
    itemId: ORDER_BOX_ITEM_ID,
    rarity: 'normal',
    state: 'carried',
    x: pos.x,
    y: pos.y,
    owner: null,
    carrier: playerId,
    looseSince: null,
    box: { van: player.van, points: banked, packedBy: playerId },
  } as const satisfies WorldItem;
  const next: ItemWorld = {
    ...deposited.world,
    nextItemId: deposited.world.nextItemId + 1,
    items: [...deposited.world.items, box],
    players: deposited.world.players.map((p) => (p.id === playerId ? { ...p, carrying: box.id } : p)),
    vanPoints: { ...deposited.world.vanPoints, [player.van]: 0 },
  };
  return {
    world: next,
    events: [...deposited.events, { type: 'boxPacked', player: playerId, van: player.van, box }],
  };
}

/**
 * A box carrier entered the office trigger (§4.2): delivery. The box leaves the world and the result
 * carries the `delivery`; the deliverer's side wins whoever packed the box ("deliver it as their own").
 * The server checks the trigger (`inOfficeTrigger`), keeps only the first delivery and ends the round
 * at once. Refuses a player who carries nothing or a normal item (`not_carrying_box`).
 */
export function deliver(world: ItemWorld, playerId: string, now: number): RaceResult {
  const player = findCarryPlayer(world, playerId);
  if (!player) return { world, events: [], rejected: 'unknown_player' };
  const box = carriedBox(world, playerId);
  if (!box) return { world, events: [], rejected: 'not_carrying_box' };
  const next: ItemWorld = {
    ...world,
    items: world.items.filter((i) => i.id !== box.id),
    players: world.players.map((p) => (p.id === playerId ? { ...p, carrying: null } : p)),
  };
  return {
    world: next,
    events: [
      { type: 'delivery', player: playerId, van: player.van, box, stolen: box.box.van !== player.van },
    ],
    delivery: { player: playerId, van: player.van, box, at: now },
  };
}

/**
 * "Items you control" for a van (§4.2): its banked points plus every box it packed that is carried by
 * a player of that van (you or a teammate). A box lying on the floor or held by an opponent counts for
 * nobody.
 */
export function itemsControlled(world: ItemWorld, van: number): number {
  let total = vanPointsOf(world, van);
  for (const box of orderBoxes(world)) {
    if (box.box.van !== van || box.state !== 'carried' || box.carrier === null) continue;
    if (findCarryPlayer(world, box.carrier)?.van === van) total += box.box.points;
  }
  return total;
}

/** True when a race round is over: a box was delivered, or the `raceRoundSeconds` cap ran out. */
export function isRaceRoundOver(secondsLeft: number, delivery: RaceDelivery | null): boolean {
  return delivery !== null || secondsLeft <= 0;
}

/** A ranked side in a race round. `itemPoints` = items the side controlled when the round ended. */
export interface RaceRanked extends Ranked {
  /** True for the side that delivered (place 1). */
  readonly delivered: boolean;
}

export interface RaceRoundResult {
  /** Every side, best first. Same shape as `TimedRoundResult.standings`, plus `delivered`. */
  readonly standings: readonly RaceRanked[];
  /** Every player, best place first, then by id. `itemPoints` stays the player's own deposits. */
  readonly players: readonly PlayerPlacement[];
  /** Side id (player id, or `team:<n>`) that delivered, or null when the time cap ended the round. */
  readonly winner: string | null;
}

/**
 * Ranks a finished race round (§4.2). Pass the players who took part (not spectators), with their own
 * deposits as `itemPoints` (session tie-break, §5), and the winning delivery or null.
 * - Delivery: the deliverer's side is 1st; everyone else is ranked by items they control at that
 *   moment (the delivered box has left the world, so it counts for nobody), from 2nd down.
 * - Time cap: everyone is ranked by items they control.
 * Ties share the higher place (5, 5, 3 → 1, 1, 3), as in Timed. A side's controlled items come from
 * the van(s) of its members in `world` (a team shares one van; a van that two members both name is
 * counted once). A player missing from the world controls nothing. With `teams` on every member takes
 * the team's place; a player with team 0 stands alone. Throws on duplicate player ids.
 */
export function rankRaceRound(
  world: ItemWorld,
  players: readonly TimedPlayerScore[],
  teams: boolean,
  delivery: RaceDelivery | null,
): RaceRoundResult {
  const sideOf = (p: { readonly id: string; readonly team: number }): string =>
    teams && p.team > 0 ? teamSideId(p.team) : p.id;
  const vansOf = new Map<string, Set<number>>();
  const ids = new Set<string>();
  for (const p of players) {
    if (ids.has(p.id)) throw new RangeError(`race: duplicate player id ${p.id}`);
    ids.add(p.id);
    const side = sideOf(p);
    const vans = vansOf.get(side) ?? new Set<number>();
    const van = findCarryPlayer(world, p.id)?.van;
    if (van !== undefined) vans.add(van);
    vansOf.set(side, vans);
  }
  const controlled = new Map<string, number>();
  for (const [side, vans] of vansOf) {
    let total = 0;
    for (const van of vans) total += itemsControlled(world, van);
    controlled.set(side, total);
  }

  const deliverer = delivery ? players.find((p) => p.id === delivery.player) : undefined;
  const winner = deliverer ? sideOf(deliverer) : null;
  const rest = rankByItemPoints(
    [...controlled].filter(([id]) => id !== winner).map(([id, itemPoints]) => ({ id, itemPoints })),
  );
  const offset = winner === null ? 0 : 1;
  const standings: RaceRanked[] = [
    ...(winner === null
      ? []
      : [{ id: winner, itemPoints: controlled.get(winner) ?? 0, place: 1, delivered: true }]),
    ...rest.map((r) => ({ ...r, place: r.place + offset, delivered: false })),
  ];
  const placeOf = new Map(standings.map((s) => [s.id, s.place]));
  const placements: PlayerPlacement[] = players.map((p) => ({
    id: p.id,
    itemPoints: p.itemPoints,
    place: placeOf.get(sideOf(p)) ?? 0,
    team: teams ? p.team : 0,
  }));
  placements.sort((a, b) => a.place - b.place || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { standings, players: placements, winner };
}
