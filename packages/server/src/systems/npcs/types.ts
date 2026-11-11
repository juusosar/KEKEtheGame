// The contract between the server NpcSystem and its NPC behaviours (§8; M5-3). Each behaviour (stocker
// here; security, forklift and butcher in M5-4 to M5-6) is ONE file exporting a factory for an
// `NpcBehaviourModule`, plus one line in modules.ts. The NpcSystem owns everything common to all NPCs:
// spawning from the round plan, HP, hits from player weapons, KO and the 30 s respawn, stun, slow, shoves,
// path following and the synced `NpcState`. A behaviour only decides where its NPCs walk and whom they hit.
import type {
  Circle,
  DropReason,
  GameConfig,
  HalfSize,
  HitSource,
  MapModel,
  MeleeStats,
  NpcBehaviour,
  NpcCatalogue,
  NpcDef,
  NpcPlacement,
  Rng,
  TileRect,
  Vec2,
  WantedWatcher,
} from '@keke/shared';
import type { NpcState, PlayerState } from '../../schema/GameState';
import type { CombatHit } from '../combat/types';

/** One NPC as behaviours see it. Write `state.mode`, `state.target` and `state.aim`; the rest is the system's. */
export interface Npc {
  /** Same as `state.id`: `<type>_<n>`. */
  readonly id: string;
  readonly def: NpcDef;
  readonly placement: NpcPlacement;
  /** The synced state. Position moves only through `ctx.walk` / `ctx.moveBy` (walls and carts apply). */
  readonly state: NpcState;
  /** Half size of the body box (npcs.json `hitboxPx` / 2). */
  readonly half: HalfSize;
}

/** A landed hit on an NPC, as its behaviour hears about it (after HP, stun and the shove were applied). */
export interface NpcHitInfo {
  readonly source: HitSource;
  readonly damage: number;
  readonly weapon: string | null;
  /** True when this hit KO'd the NPC (`onKo` follows). */
  readonly ko: boolean;
}

/** Result of one `ctx.walk` step. */
export type WalkResult = 'walking' | 'arrived' | 'unreachable';

export interface NpcMeleeSwing {
  /** Melee stats from npcs.json (weapons.json melee shape). */
  readonly melee: MeleeStats;
  /** Swing direction, radians. */
  readonly aim: number;
  /** Only these players can be hit (stocker: its attacker). Undefined = every round player in the arc. */
  readonly only?: readonly string[];
}

export interface NpcContext {
  readonly config: GameConfig;
  /** The live map: its collision includes parked stock carts. */
  readonly map: MapModel;
  readonly catalogue: NpcCatalogue;
  /** Round clock, seconds. */
  readonly now: number;
  /** The room's NPC RNG (seeded): use it for every random choice. */
  readonly rng: Rng;
  /** Round players with a body that is up (alive, not spectating, connected), in join order. */
  players(): readonly PlayerState[];
  /** A round player that is up and connected, or undefined (left, KO'd, spectating, offline). */
  player(id: string): PlayerState | undefined;
  /** Players who are Wanted now (§8; what guards chase). */
  wantedPlayers(): readonly string[];
  /** Security guards that are up, for the wanted rules' witness check. */
  guards(): readonly WantedWatcher[];
  /** Solid NPC bodies that are up (customers), which block sight (`bodiesBlockLine`). */
  sightBlockers(): readonly Circle[];
  /**
   * Walks `npc` toward `goal` at `speedPxPerSecond` (times its slow) for one tick, along an A* path that is
   * recomputed only on events: a new goal more than half a tile from the last one, a stock cart that came
   * or went, the NPC getting stuck, or after a failed search once a second has passed. Sets `aim` and `moving`.
   */
  walk(npc: Npc, goal: Vec2, speedPxPerSecond: number): WalkResult;
  /** Stops walking this tick (`moving` false) and forgets the path. */
  stop(npc: Npc): void;
  /** Turns `npc` toward a point. */
  face(npc: Npc, at: Vec2): void;
  /**
   * Swings `swing.melee` from the NPC along `swing.aim`: every eligible player in the arc takes the hit
   * (source `{ kind: 'npc', id }`, through the combat system, so blocks and KO item drops apply) and an
   * `npcAttack` event is broadcast. Returns the ids hit. Cooldowns are the behaviour's job.
   */
  swing(npc: Npc, swing: NpcMeleeSwing): string[];
  /**
   * Moves `npc` by `delta` pixels this tick through walls and carts (`moveAabb`), for NPCs that follow a
   * fixed route instead of `walk` (forklifts). Sets `aim` and `moving`. Returns the moveAabb result.
   */
  moveBy(npc: Npc, delta: Vec2): { x: number; y: number; hitX: boolean; hitY: boolean };
  /**
   * Lands any hit on a player through the combat system (block, KO, item drop), e.g. a forklift's contact
   * with `source: { kind: 'hazard', id: npc.id }`. True when it landed.
   */
  hitPlayer(hit: CombatHit): boolean;
  /** Makes a round player drop what they carry where they stand (forklift contact). */
  dropCarried(playerId: string, reason: DropReason): void;
  /**
   * Parks a stock cart of `lengthTiles` next to the NPC for `seconds` (shared `placeStockCart`). Never on
   * a body, another cart, or in the loading dock. Returns the cart's tiles, or null when there is no room.
   */
  placeStockCart(npc: Npc, lengthTiles: number, seconds: number): TileRect | null;
}

export interface NpcBehaviourModule {
  /** The npcs.json behaviour this module runs. NPCs of behaviours without a module are not spawned. */
  readonly behaviour: NpcBehaviour;
  /** The NPC appeared (round start or respawn) with full HP at its spawn: set up its memory. */
  spawn(ctx: NpcContext, npc: Npc): void;
  /** Once per server tick for each NPC of this behaviour that is up and not stunned or being shoved. */
  tick(ctx: NpcContext, npc: Npc, dt: number): void;
  /** A hit landed on one of this behaviour's NPCs (stocker: retaliate). */
  onHit?(ctx: NpcContext, npc: Npc, hit: NpcHitInfo): void;
  /**
   * Violence happened at `at` this tick (a landed hit on a player or an NPC, which covers splashes,
   * KOs and forklift run-overs; Phase 2 decision 8). Called for each NPC of this behaviour that is up,
   * wherever it is: the behaviour checks the distance. Customers panic.
   */
  onViolence?(ctx: NpcContext, npc: Npc, at: Vec2): void;
  /** The NPC was KO'd: forget what it was doing (`spawn` runs again on respawn). */
  onKo?(ctx: NpcContext, npc: Npc): void;
  /** A player left the round for good: stop chasing them. */
  removePlayer?(id: string): void;
  /** Round start or back to the lobby: forget everything. */
  reset?(): void;
}
