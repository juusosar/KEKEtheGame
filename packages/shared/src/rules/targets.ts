// Target assignment (§3.1, model "c"). Kept behind the small `TargetAssigner` interface because §3.1 and
// §20 flag the model for iteration after playtests: a new model is a new assigner, not a rewrite.
// Ownership changes on pickup live in carry.ts; this file only decides what a new target is and where.
import type { GameConfig } from '../config';
import type { Rng } from '../rng';
import type { Vec2 } from '../types';
import type { ItemRarity } from './scoring';

/** Zone value of joke items: they may spawn at any item spawn point (§10.1). */
export const ANY_ZONE = 'any';

/**
 * What target assignment needs from a catalogue entry (§10). The full item type from the catalogue
 * (M3-1) has more fields (name, desc, sprite) and satisfies this shape.
 */
export interface TargetItemDef {
  readonly id: string;
  /** Zone id the item spawns in, or `any` for joke items. */
  readonly zone: string;
  readonly rarity: ItemRarity;
}

/** An item spawn point. `ItemSpawn` from shared/src/map satisfies this shape. */
export interface TargetSpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly zone: string;
}

/** What target assignment needs from a map. `MapModel` from shared/src/map satisfies this shape. */
export interface TargetMap {
  readonly tileSize: number;
  readonly vanSlots: readonly Vec2[];
  readonly itemSpawns: readonly TargetSpawnPoint[];
}

/** The config keys target assignment reads. A full `GameConfig` works. */
export type TargetConfig = Pick<GameConfig, 'jokeItemChance' | 'targetMinDistanceFromVanTiles'>;

export interface TargetRequest {
  readonly catalogue: readonly TargetItemDef[];
  readonly map: TargetMap;
  /** Positions of items lying in the world (targets and loose items). Spawns under them are taken. */
  readonly occupied: readonly Vec2[];
  readonly rng: Rng;
  readonly config: TargetConfig;
}

/** A new target: which catalogue item, and the spawn point it appears at. */
export interface TargetPlacement {
  readonly item: TargetItemDef;
  readonly x: number;
  readonly y: number;
  /** Zone of the spawn point (for joke items this is where it landed, not `any`). */
  readonly zone: string;
}

/** Decides a player's next target. Returns undefined when no item can be placed right now. */
export interface TargetAssigner {
  readonly id: string;
  place(request: TargetRequest): TargetPlacement | undefined;
}

/**
 * Spawn points a new target may use (§3.1): at least `targetMinDistanceFromVanTiles` tiles from every
 * van slot, and not occupied. A spawn counts as occupied when an item lies within half a tile of it.
 */
export function eligibleSpawns(
  map: TargetMap,
  occupied: readonly Vec2[],
  config: Pick<GameConfig, 'targetMinDistanceFromVanTiles'>,
): TargetSpawnPoint[] {
  const minVanDist = config.targetMinDistanceFromVanTiles * map.tileSize;
  const occupiedRadius = map.tileSize / 2;
  return map.itemSpawns.filter(
    (spawn) =>
      map.vanSlots.every((van) => Math.hypot(spawn.x - van.x, spawn.y - van.y) >= minVanDist) &&
      occupied.every((pos) => Math.hypot(spawn.x - pos.x, spawn.y - pos.y) >= occupiedRadius),
  );
}

/** Spawns from `spawns` where `item` may appear: its own zone, or any spawn for zone `any`. */
export function spawnsForItem(item: TargetItemDef, spawns: readonly TargetSpawnPoint[]): TargetSpawnPoint[] {
  return item.zone === ANY_ZONE ? [...spawns] : spawns.filter((s) => s.zone === item.zone);
}

/**
 * Model "c" (§3.1, §10.1):
 * - with chance `jokeItemChance` the target is a joke item, otherwise a normal item;
 * - the item is picked uniformly among items of that rarity that have a free eligible spawn, and the
 *   spawn uniformly among that item's free eligible spawns;
 * - if no item of the rolled rarity can be placed, the other rarity is used; if nothing fits, undefined.
 *
 * The joke roll always consumes one random number, so the RNG sequence does not depend on the catalogue.
 */
export const modelCAssigner: TargetAssigner = {
  id: 'c',
  place({ catalogue, map, occupied, rng, config }) {
    const free = eligibleSpawns(map, occupied, config);
    const wantJoke = rng.chance(config.jokeItemChance);
    const placeable = (rarity: ItemRarity): TargetItemDef[] =>
      catalogue.filter((item) => item.rarity === rarity && spawnsForItem(item, free).length > 0);
    let candidates = placeable(wantJoke ? 'joke' : 'normal');
    if (candidates.length === 0) candidates = placeable(wantJoke ? 'normal' : 'joke');
    if (candidates.length === 0) return undefined;
    const item = rng.pick(candidates);
    const spawn = rng.pick(spawnsForItem(item, free));
    return { item, x: spawn.x, y: spawn.y, zone: spawn.zone };
  },
};
