// The contract between the server CombatSystem and its behaviour modules (M4-2). Each weapon behaviour
// (melee here; thrown, spray, trap, block, shot and charge in M4-3 to M4-6) is one module that gets the
// input frames of players holding a weapon of its attack mode, and a context to spend uses, find
// bodies, land hits and shove players. Modules never touch the CombatWorld or the schema directly.
import type {
  AttackMode,
  AttackRejection,
  Combatant,
  GameConfig,
  HitSource,
  HitSpec,
  MapModel,
  Vec2,
  WeaponCatalogue,
  WeaponDef,
} from '@keke/shared';
import type { PlayerState } from '../../schema/GameState';

/**
 * One applied input frame of a living round player, recorded in `afterFrame` and resolved after every
 * player has moved this tick (M3 review H3). Position and aim are the attacker's at that frame.
 */
export interface FrameIntent {
  readonly player: string;
  readonly x: number;
  readonly y: number;
  readonly aim: number;
  readonly move: Vec2;
  /** Buttons that went down in this frame (edges): single attacks (swing, throw, peel, shot). */
  readonly pressed: number;
  /** Buttons held in this frame: block, spray, charge. */
  readonly held: number;
}

/** How a hit was delivered; `adjustHit` hooks use it (e.g. the pan block only softens melee). */
export type HitDelivery = 'melee' | 'projectile' | 'area' | 'spray' | 'trap' | 'charge' | 'hazard';

/** A hit plus how it arrived and the shove that comes with it. */
export interface CombatHit extends HitSpec {
  readonly delivery: HitDelivery;
  /** Shove the target `px` pixels along `dir` (unit vector) if the hit lands. */
  readonly knockback?: { readonly dir: Vec2; readonly px: number };
  /** The ProjectileSystem id of the projectile that delivered it ('projectile' hits), e.g. for a reflect. */
  readonly projectile?: number;
}

/** Something a player's weapon can hit right now: a round player or a store worker (M5-3). */
export interface HitTarget {
  readonly id: string;
  readonly kind: 'player' | 'npc';
  readonly x: number;
  readonly y: number;
}

/**
 * The NPC side of combat (M5-3; NpcSystem implements it). NPC ids never collide with player sessionIds in
 * practice ('stocker_1' vs Colyseus ids); a player with the id wins.
 */
export interface NpcTargets {
  /** NPCs that can take hits now (up, not invulnerable), with their body centres. */
  bodies(): readonly { readonly id: string; readonly x: number; readonly y: number }[];
  has(id: string): boolean;
  canHit(source: HitSource, id: string): boolean;
  /** Applies a hit (already through `adjustHit`) to an NPC. True when it landed. */
  hit(hit: CombatHit): boolean;
  push(id: string, dir: Vec2, px: number): void;
  position(id: string): Vec2 | undefined;
}

export interface CombatContext {
  readonly config: GameConfig;
  readonly map: MapModel;
  readonly weapons: WeaponCatalogue;
  /** Round clock in seconds. */
  readonly now: number;
  /** Half the player hitbox: the radius used for hit tests on player bodies. */
  readonly bodyRadius: number;
  /** A round player's synced state. */
  player(id: string): PlayerState | undefined;
  combatant(id: string): Combatant | undefined;
  /** Round players with a body on the map (not spectators), alive or not, in join order. */
  bodies(): readonly PlayerState[];
  /**
   * Everything `source` can hit now: round players that pass `canHit`, then store workers (M5-3). Weapon
   * modules pick their targets from this, so NPCs take hits from every weapon.
   */
  targets(source: HitSource): readonly HitTarget[];
  /** Body centre of a round player or an NPC. */
  position(id: string): Vec2 | undefined;
  /** Why `id` cannot attack now (KO, stun, cooldown), or null. */
  attackBlocked(id: string): AttackRejection | null;
  /**
   * Spends `amount` uses of the held weapon (1, or sprayed seconds) and broadcasts an `attack` event from
   * the intent's position and aim. Returns false (and changes nothing) when the attack is blocked.
   */
  use(intent: FrameIntent, def: WeaponDef, mode: AttackMode, amount?: number): boolean;
  /** Whether a hit from `source` on `target` would land (team, KO, protection, self rules; §3.3). */
  canHit(source: HitSource, target: string, allowSelf?: boolean): boolean;
  /**
   * Lands a hit: runs every module's `adjustHit`, applies it to the CombatWorld, broadcasts `hit` (and
   * `ko`), starts the shove and handles KO (item drop). Returns true when it landed.
   */
  hit(hit: CombatHit): boolean;
  /** Shoves a round player (or an NPC) `px` pixels along `dir`, without a hit (e.g. a spray push step). */
  push(target: string, dir: Vec2, px: number): void;
  /**
   * Scatters the lying items within `halfWidth` of the segment from→to `px` pixels out of the line
   * (pallet jack, M4-6). Nothing happens when the room has no item hook.
   */
  scatterItems(from: Vec2, to: Vec2, halfWidth: number, px: number): void;
  /**
   * Shoves the pushable carts the band from→to touches along `dir` (pallet jack, P2-5), except `skip`.
   * Returns the ids shoved; none when the room has no cart hook.
   */
  shoveCarts(from: Vec2, to: Vec2, halfWidth: number, dir: Vec2, skip: ReadonlySet<number>): number[];
  /** The round player drops what they carry where they stand (banana peel slip, M4-5). */
  dropCarried(target: string): void;
}

export interface BehaviourModule {
  /** For logs and tests. */
  readonly name: string;
  /** Frames of players whose held weapon is in one of these attack modes go to `onFrame`. */
  readonly modes: readonly AttackMode[];
  /** One frame of a living player holding a weapon of this module's modes. `def` is the held weapon. */
  onFrame?(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void;
  /**
   * Every frame of every living round player, whatever they hold (block, M4-6). Runs before `onFrame`.
   * Return true to take the frame: the held weapon's `onFrame` does not run (no attacks while blocking).
   */
  onAnyFrame?(ctx: CombatContext, intent: FrameIntent, def: WeaponDef): unknown;
  /** Change or cancel (null) a hit before it lands, e.g. block. Runs in module order. */
  adjustHit?(ctx: CombatContext, hit: CombatHit): CombatHit | null;
  /** Once per server tick, after this tick's frames (projectiles fly, traps trigger, charges move). */
  tick?(ctx: CombatContext, dt: number): void;
  /** A round starts or the room goes back to the lobby: forget everything. */
  reset?(): void;
  /** A player left for good, or was KO'd (`ko: true`): stop anything they were doing. */
  removePlayer?(id: string, ko: boolean): void;
  /** The player dropped (reconnect window open, M4 review F8): stop anything they keep doing unattended. */
  onDisconnect?(id: string): void;
}
