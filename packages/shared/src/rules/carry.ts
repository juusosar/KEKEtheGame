// Items in the world, carrying, deposits and loose-item despawn (§3.1, §3.2). Pure and immutable: each
// operation takes an `ItemWorld` and returns a new one plus the events it caused, so the server can
// mirror the result into its schema and broadcast the events (`pickup`, `deposit`, ...), and tests can
// replay any sequence. Positions and range checks (is the player near the item / at their van) are the
// server's job; these rules only decide what is allowed and what changes.
import type { GameConfig } from '../config';
import type { Rng } from '../rng';
import type { Vec2 } from '../types';
import type { ItemRarity } from '../items/catalogue';
import { itemValue } from './scoring';
import {
  modelCAssigner,
  type TargetAssigner,
  type TargetConfig,
  type TargetItemDef,
  type TargetMap,
} from './targets';

/** Where an item is: lying as someone's target, lying loose with no owner, or carried by a player. */
export type WorldItemState = 'target' | 'loose' | 'carried';

export interface WorldItem {
  /** Unique within one `ItemWorld` (one round). */
  readonly id: number;
  /** Catalogue item id. */
  readonly itemId: string;
  readonly rarity: ItemRarity;
  readonly state: WorldItemState;
  /** World position in pixels. For a carried item: where it was picked up (render it at the carrier). */
  readonly x: number;
  readonly y: number;
  /** Player whose target this is. Set only while `state` is `target`. */
  readonly owner: string | null;
  /** Player carrying it. Set only while `state` is `carried`. */
  readonly carrier: string | null;
  /** Round time (s) it became loose. Set only while `state` is `loose`. */
  readonly looseSince: number | null;
  /**
   * Set only on a race-mode order box (§4.2, modes/race.ts). A box is carried, dropped, stolen and
   * scattered like any item, but it cannot be deposited and never despawns.
   */
  readonly box?: OrderBox;
}

/** What an order box holds (§4.2): the banked points of the van that packed it. */
export interface OrderBox {
  /** Van whose items were packed. "Items you control" counts the box for this van only. */
  readonly van: number;
  /** Item points packed into the box (the van's banked total when it reached the quota). */
  readonly points: number;
  /** The player whose deposit reached the quota (they picked the box up). */
  readonly packedBy: string;
}

export interface CarryPlayer {
  readonly id: string;
  /** Van that scores this player's deposits. Teammates share one van (§4.3). */
  readonly van: number;
  /** World item id being carried, or null. At most one (§3.2). */
  readonly carrying: number | null;
  /** World item id of this player's current target, or null. */
  readonly target: number | null;
  /** Item points this player deposited (for session tie-breaks, §5). */
  readonly deposited: number;
}

export interface ItemWorld {
  readonly nextItemId: number;
  readonly items: readonly WorldItem[];
  /** In join order. Targets are assigned in this order. */
  readonly players: readonly CarryPlayer[];
  /** Banked item points per van (§3.2: deposits cannot be stolen). */
  readonly vanPoints: Readonly<Record<number, number>>;
}

/** 'slip': stepped on a banana peel (§7, M4-5). 'forklift': run over by a forklift (§8, M5-5). */
export type DropReason = 'drop' | 'ko' | 'disconnect' | 'slip' | 'forklift';

/** How a pickup relates to target ownership (§3.1). 'box': a race-mode order box (§4.2). */
export type PickupKind = 'own_target' | 'other_target' | 'loose' | 'box';

export type ItemEvent =
  | { readonly type: 'targetAssigned'; readonly player: string; readonly item: WorldItem }
  | {
      readonly type: 'pickup';
      readonly player: string;
      readonly item: WorldItem;
      readonly kind: PickupKind;
      /** For `other_target`: the player whose target was taken (they get a new one). */
      readonly targetOwner: string | null;
    }
  | { readonly type: 'drop'; readonly player: string; readonly item: WorldItem; readonly reason: DropReason }
  | {
      readonly type: 'deposit';
      readonly player: string;
      readonly item: WorldItem;
      readonly van: number;
      readonly points: number;
      readonly vanTotal: number;
    }
  | { readonly type: 'despawn'; readonly item: WorldItem };

/** Why an action was refused. The world is unchanged when this is set. */
export type CarryRejection =
  | 'unknown_player'
  | 'unknown_item'
  | 'already_carrying'
  | 'item_carried'
  | 'not_carrying'
  /** An order box cannot be deposited into a van (§4.2). */
  | 'box_not_depositable';

export interface CarryResult {
  readonly world: ItemWorld;
  readonly events: readonly ItemEvent[];
  readonly rejected?: CarryRejection;
}

export function createItemWorld(): ItemWorld {
  return { nextItemId: 1, items: [], players: [], vanPoints: {} };
}

export function findCarryPlayer(world: ItemWorld, id: string): CarryPlayer | undefined {
  return world.players.find((p) => p.id === id);
}

export function findItem(world: ItemWorld, id: number): WorldItem | undefined {
  return world.items.find((i) => i.id === id);
}

/** True while the player carries an item: movement then uses `carrySpeedMultiplier` (§3.2). */
export function isCarrying(world: ItemWorld, playerId: string): boolean {
  return findCarryPlayer(world, playerId)?.carrying != null;
}

/** Banked points of a van (0 if nothing deposited yet). */
export function vanPointsOf(world: ItemWorld, van: number): number {
  return world.vanPoints[van] ?? 0;
}

/** Adds a player with no target and nothing carried. Throws if the id is already present. */
export function addCarryPlayer(world: ItemWorld, id: string, van: number): ItemWorld {
  if (findCarryPlayer(world, id)) throw new Error(`addCarryPlayer: player ${id} already exists`);
  return { ...world, players: [...world.players, { id, van, carrying: null, target: null, deposited: 0 }] };
}

/** Changes the van that scores a player's future deposits (e.g. teams rebalanced between rounds). */
export function setPlayerVan(world: ItemWorld, id: string, van: number): ItemWorld {
  return { ...world, players: world.players.map((p) => (p.id === id ? { ...p, van } : p)) };
}

/**
 * Removes a player for good (left the room). A carried item drops loose at `pos` (§3.2); their target
 * despawns, since nobody is hunting it any more. Banked van points stay.
 */
export function removeCarryPlayer(world: ItemWorld, id: string, pos: Vec2, now: number): CarryResult {
  const player = findCarryPlayer(world, id);
  if (!player) return reject(world, 'unknown_player');
  let current = world;
  const events: ItemEvent[] = [];
  if (player.carrying != null) {
    const dropped = drop(current, id, pos, now, 'disconnect');
    current = dropped.world;
    events.push(...dropped.events);
  }
  const target = player.target != null ? findItem(current, player.target) : undefined;
  if (target) events.push({ type: 'despawn', item: target });
  current = {
    ...current,
    items: current.items.filter((i) => i.id !== target?.id),
    players: current.players.filter((p) => p.id !== id),
  };
  return { world: current, events };
}

export interface AssignTargetsContext {
  readonly catalogue: readonly TargetItemDef[];
  readonly map: TargetMap;
  readonly rng: Rng;
  readonly config: TargetConfig;
  /** Defaults to model "c". */
  readonly assigner?: TargetAssigner;
}

/**
 * Gives a new target to every player who is not carrying and has none (§3.1: exactly one target while
 * not carrying). Call it after any change (round start, pickup, drop, deposit, KO) so a player who
 * loses a target gets the next one in the same tick. Players for whom nothing can be placed (no free
 * eligible spawn) stay without a target until a later call succeeds.
 */
export function assignTargets(world: ItemWorld, ctx: AssignTargetsContext): CarryResult {
  const assigner = ctx.assigner ?? modelCAssigner;
  let current = world;
  const events: ItemEvent[] = [];
  for (const player of world.players) {
    if (player.carrying != null || player.target != null) continue;
    const occupied = current.items.filter((i) => i.state !== 'carried').map((i) => ({ x: i.x, y: i.y }));
    const placement = assigner.place({
      catalogue: ctx.catalogue,
      map: ctx.map,
      occupied,
      rng: ctx.rng,
      config: ctx.config,
    });
    if (!placement) continue;
    const item: WorldItem = {
      id: current.nextItemId,
      itemId: placement.item.id,
      rarity: placement.item.rarity,
      state: 'target',
      x: placement.x,
      y: placement.y,
      owner: player.id,
      carrier: null,
      looseSince: null,
    };
    current = {
      ...current,
      nextItemId: current.nextItemId + 1,
      items: [...current.items, item],
      players: current.players.map((p) => (p.id === player.id ? { ...p, target: item.id } : p)),
    };
    events.push({ type: 'targetAssigned', player: player.id, item });
  }
  return { world: current, events };
}

/**
 * A player picks up a lying item (§3.1, §3.2). Anyone can pick up any item that is not carried, if
 * they are not carrying one already. Picking up a target clears its ownership: your own target leaves
 * you with no target while carrying; someone else's leaves them without one, so the next
 * `assignTargets` gives them a new target. Your own target stays where it is.
 */
export function pickup(world: ItemWorld, playerId: string, itemId: number): CarryResult {
  const player = findCarryPlayer(world, playerId);
  if (!player) return reject(world, 'unknown_player');
  if (player.carrying != null) return reject(world, 'already_carrying');
  const item = findItem(world, itemId);
  if (!item) return reject(world, 'unknown_item');
  if (item.state === 'carried') return reject(world, 'item_carried');

  const kind: PickupKind = item.box
    ? 'box'
    : item.state === 'loose'
      ? 'loose'
      : item.owner === playerId
        ? 'own_target'
        : 'other_target';
  const targetOwner = kind === 'other_target' ? item.owner : null;
  const carried: WorldItem = { ...item, state: 'carried', owner: null, carrier: playerId, looseSince: null };
  const players = world.players.map((p) => {
    if (p.id === playerId) {
      return { ...p, carrying: item.id, target: kind === 'own_target' ? null : p.target };
    }
    if (p.id === targetOwner) return { ...p, target: null };
    return p;
  });
  return {
    world: { ...world, players, items: replaceItem(world.items, carried) },
    events: [{ type: 'pickup', player: playerId, item: carried, kind, targetOwner }],
  };
}

/**
 * The carried item drops as a loose item at `pos` (§3.2): on purpose (drop key), on KO, or on
 * disconnect (§15.3). It despawns after `looseItemDespawnSeconds` unless someone grabs it. The player
 * then needs a target again (given by the next `assignTargets` if they have none).
 */
export function drop(
  world: ItemWorld,
  playerId: string,
  pos: Vec2,
  now: number,
  reason: DropReason,
): CarryResult {
  const player = findCarryPlayer(world, playerId);
  if (!player) return reject(world, 'unknown_player');
  const item = player.carrying != null ? findItem(world, player.carrying) : undefined;
  if (!item) return reject(world, 'not_carrying');
  const loose: WorldItem = {
    ...item,
    state: 'loose',
    x: pos.x,
    y: pos.y,
    owner: null,
    carrier: null,
    looseSince: now,
  };
  return {
    world: {
      ...world,
      items: replaceItem(world.items, loose),
      players: world.players.map((p) => (p.id === playerId ? { ...p, carrying: null } : p)),
    },
    events: [{ type: 'drop', player: playerId, item: loose, reason }],
  };
}

/**
 * The player deposits the carried item in their van (§3 step 5): the van banks the item's points
 * (1, or `jokeItemValue` for a joke item) and the item leaves the world. Whoever deposits scores,
 * whoever's target it was. The next `assignTargets` gives the player a new target.
 */
export function deposit(
  world: ItemWorld,
  playerId: string,
  config: Pick<GameConfig, 'jokeItemValue'>,
): CarryResult {
  const player = findCarryPlayer(world, playerId);
  if (!player) return reject(world, 'unknown_player');
  const item = player.carrying != null ? findItem(world, player.carrying) : undefined;
  if (!item) return reject(world, 'not_carrying');
  if (item.box) return reject(world, 'box_not_depositable');
  const points = itemValue(item.rarity, config);
  const vanTotal = vanPointsOf(world, player.van) + points;
  return {
    world: {
      ...world,
      items: world.items.filter((i) => i.id !== item.id),
      players: world.players.map((p) =>
        p.id === playerId ? { ...p, carrying: null, deposited: p.deposited + points } : p,
      ),
      vanPoints: { ...world.vanPoints, [player.van]: vanTotal },
    },
    events: [{ type: 'deposit', player: playerId, item, van: player.van, points, vanTotal }],
  };
}

/**
 * Removes loose items that have lain for `looseItemDespawnSeconds` or longer (§3.1). Targets and
 * order boxes never despawn (a lying box stays until someone picks it up, §4.2).
 */
export function despawnLooseItems(
  world: ItemWorld,
  now: number,
  config: Pick<GameConfig, 'looseItemDespawnSeconds'>,
): CarryResult {
  const expired = world.items.filter(
    (i) =>
      i.state === 'loose' &&
      !i.box &&
      i.looseSince != null &&
      now - i.looseSince >= config.looseItemDespawnSeconds,
  );
  if (expired.length === 0) return { world, events: [] };
  const gone = new Set(expired.map((i) => i.id));
  return {
    world: { ...world, items: world.items.filter((i) => !gone.has(i.id)) },
    events: expired.map((item) => ({ type: 'despawn', item })),
  };
}

/**
 * Moves lying items (targets and loose ones) to new positions, e.g. scattered by a pallet jack dash
 * (§7, M4-6). Carried items and unknown ids are skipped; nothing else about an item changes.
 */
export function moveLyingItems(
  world: ItemWorld,
  moves: readonly { readonly id: number; readonly x: number; readonly y: number }[],
): CarryResult {
  const to = new Map(moves.map((m) => [m.id, m]));
  let changed = false;
  const items = world.items.map((i) => {
    const m = to.get(i.id);
    if (!m || i.state === 'carried' || (m.x === i.x && m.y === i.y)) return i;
    changed = true;
    return { ...i, x: m.x, y: m.y };
  });
  return changed ? { world: { ...world, items }, events: [] } : { world, events: [] };
}

function replaceItem(items: readonly WorldItem[], item: WorldItem): WorldItem[] {
  return items.map((i) => (i.id === item.id ? item : i));
}

function reject(world: ItemWorld, rejected: CarryRejection): CarryResult {
  return { world, events: [], rejected };
}
