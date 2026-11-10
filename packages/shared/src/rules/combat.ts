// Combat core (§3.3, §7): held weapons, the weapon roll on pickup, HP, hits, KO, respawn, spawn
// protection, stun/slow and team no-friendly-fire. Pure and immutable like carry.ts: each operation takes a
// `CombatWorld` and returns a new one plus the events it caused (`weaponRolled`, `hit`, `ko`, ...), so the
// server can mirror it into its schema and broadcast the events. Geometry (who is inside an arc, cone,
// splash or dash line), knockback and positions are the behaviour systems' job (M4-2 to M4-6); they ask
// `canHit` / call `hit` for every target they find. `now` is the round clock in seconds (§21: pass time in).
import type { GameConfig } from '../config';
import type { Rng, Weighted } from '../rng';
import type { Vec2 } from '../types';
import { ROLL_RARITIES, type RollRarity, type WeaponCatalogue, type WeaponDef } from '../weapons/catalogue';
import { drop, type CarryResult, type ItemEvent, type ItemWorld } from './carry';

export type CombatConfig = Pick<
  GameConfig,
  'maxHp' | 'respawnSeconds' | 'spawnProtectionSeconds' | 'hpRegenPerSec' | 'weaponRarityWeights'
>;

/** The weapon a player holds right now. */
export interface HeldWeapon {
  /** Weapon id in the catalogue. */
  readonly id: string;
  /** Uses left (seconds of spray for sprays); null = unlimited (fists). */
  readonly uses: number | null;
  /** Round time from which the next use is allowed (cooldown). */
  readonly readyAt: number;
}

export interface Combatant {
  readonly id: string;
  /** 0 = no team; 1 or 2 with Teams on. Teammates cannot hurt each other (§3.3). */
  readonly team: number;
  readonly hp: number;
  readonly alive: boolean;
  /** Round time the player respawns; set only while KO'd. */
  readonly respawnAt: number | null;
  /** Spawn protection: cannot be hit before this round time (§3.3). */
  readonly protectedUntil: number;
  readonly weapon: HeldWeapon;
  /** Cannot move or attack before this round time. */
  readonly stunnedUntil: number;
  /** Speed multiplier from a slow, active before `slowUntil`. */
  readonly slowMultiplier: number;
  readonly slowUntil: number;
}

export interface CombatWorld {
  /** In join order. */
  readonly players: readonly Combatant[];
}

/** Who dealt a hit. Only `player` hits are subject to team and self rules; NPCs and hazards hit anyone. */
export type HitSource =
  | { readonly kind: 'player'; readonly id: string }
  | { readonly kind: 'npc'; readonly id: string }
  | { readonly kind: 'hazard'; readonly id: string };

export interface HitSpec {
  readonly source: HitSource;
  readonly target: string;
  /** HP to take off (0 for effect-only hits such as a push or a slip). */
  readonly damage: number;
  /** Weapon id behind the hit, for the event feed. */
  readonly weapon?: string;
  readonly stunSeconds?: number;
  readonly slow?: { readonly multiplier: number; readonly seconds: number };
  /** Let a player's own hit land on themselves (e.g. slipping on your own banana peel). */
  readonly allowSelf?: boolean;
}

export type CombatEvent =
  | {
      readonly type: 'weaponRolled';
      readonly player: string;
      readonly weapon: string;
      readonly uses: number | null;
      /** The weapon it replaced. */
      readonly previous: string;
    }
  /** A weapon ran out of uses; the player is back to the fallback (fists). */
  | { readonly type: 'weaponSpent'; readonly player: string; readonly weapon: string }
  | {
      readonly type: 'hit';
      readonly source: HitSource;
      readonly target: string;
      readonly damage: number;
      readonly weapon: string | null;
      readonly hp: number;
    }
  /** At 0 HP (§3.3). The weapon is lost; the server drops the carried item (see `dropItemsOnKo`). */
  | {
      readonly type: 'ko';
      readonly player: string;
      readonly source: HitSource;
      readonly weapon: string | null;
      readonly respawnAt: number;
    }
  | { readonly type: 'respawn'; readonly player: string; readonly protectedUntil: number };

/** Why a hit does not land. */
export type HitRejection = 'unknown_player' | 'ko' | 'protected' | 'friendly' | 'self';
/** Why a player cannot use their weapon right now. */
export type AttackRejection = 'unknown_player' | 'ko' | 'stunned' | 'cooldown';

export interface CombatResult {
  readonly world: CombatWorld;
  readonly events: readonly CombatEvent[];
  readonly rejected?: HitRejection | AttackRejection;
}

export function createCombatWorld(): CombatWorld {
  return { players: [] };
}

export function findCombatant(world: CombatWorld, id: string): Combatant | undefined {
  return world.players.find((p) => p.id === id);
}

function fallbackHeld(weapons: WeaponCatalogue, readyAt: number): HeldWeapon {
  return { id: weapons.fallback.id, uses: weapons.fallback.uses, readyAt };
}

/** Adds a player at full HP with the fallback weapon (fists). No spawn protection at round start. Throws on a duplicate id. */
export function addCombatant(
  world: CombatWorld,
  id: string,
  team: number,
  weapons: WeaponCatalogue,
  config: CombatConfig,
): CombatWorld {
  if (findCombatant(world, id)) throw new Error(`addCombatant: player ${id} already exists`);
  const player: Combatant = {
    id,
    team,
    hp: config.maxHp,
    alive: true,
    respawnAt: null,
    protectedUntil: 0,
    weapon: fallbackHeld(weapons, 0),
    stunnedUntil: 0,
    slowMultiplier: 1,
    slowUntil: 0,
  };
  return { players: [...world.players, player] };
}

export function removeCombatant(world: CombatWorld, id: string): CombatWorld {
  return { players: world.players.filter((p) => p.id !== id) };
}

export function setCombatTeam(world: CombatWorld, id: string, team: number): CombatWorld {
  return update(world, id, (p) => ({ ...p, team }));
}

/** True when both are players on the same team (team 0 means no team, so never friendly). */
export function isFriendly(a: Pick<Combatant, 'team'>, b: Pick<Combatant, 'team'>): boolean {
  return a.team !== 0 && a.team === b.team;
}

// ── Weapon roll (§7) ───────────────────────────────────────────────────────────

/**
 * Rolls a weapon: first a rarity by `weaponRarityWeights` (common 55, uncommon 33, rare 12), then one
 * weapon of that rarity uniformly. Rarities without weapons are skipped. The fallback is never rolled.
 */
export function rollWeapon(
  weapons: WeaponCatalogue,
  rng: Rng,
  config: Pick<CombatConfig, 'weaponRarityWeights'>,
): WeaponDef {
  const tiers: Weighted<RollRarity>[] = ROLL_RARITIES.filter((r) => weapons.ofRarity(r).length > 0).map(
    (r) => ({
      value: r,
      weight: config.weaponRarityWeights[r],
    }),
  );
  return rng.pick(weapons.ofRarity(rng.weightedPick(tiers)));
}

/** What was picked up. Only items roll a weapon; an order box does not (§7). */
export type PickupWhat = 'item' | 'order_box';

/**
 * Call after a successful pickup (carry.ts `pickup`). Picking up an item rolls a new weapon that replaces
 * the current one with full uses, ready at once (§7, pillar 2). An order box changes nothing.
 */
export function armOnPickup(
  world: CombatWorld,
  playerId: string,
  what: PickupWhat,
  weapons: WeaponCatalogue,
  rng: Rng,
  config: CombatConfig,
  now: number,
): CombatResult {
  const player = findCombatant(world, playerId);
  if (!player) return { world, events: [], rejected: 'unknown_player' };
  if (what === 'order_box') return { world, events: [] };
  const rolled = rollWeapon(weapons, rng, config);
  return {
    world: update(world, playerId, (p) => ({
      ...p,
      weapon: { id: rolled.id, uses: rolled.uses, readyAt: now },
    })),
    events: [
      {
        type: 'weaponRolled',
        player: playerId,
        weapon: rolled.id,
        uses: rolled.uses,
        previous: player.weapon.id,
      },
    ],
  };
}

// ── Attacking ──────────────────────────────────────────────────────────────────

/** Why `playerId` cannot use their weapon at `now`, or null if they can. */
export function attackBlocked(world: CombatWorld, playerId: string, now: number): AttackRejection | null {
  const p = findCombatant(world, playerId);
  if (!p) return 'unknown_player';
  if (!p.alive) return 'ko';
  if (now < p.stunnedUntil) return 'stunned';
  if (now < p.weapon.readyAt) return 'cooldown';
  return null;
}

/**
 * Spends uses of the held weapon and starts its cooldown. `amount` is 1 for a swing, throw, peel or
 * charge, and the sprayed seconds (e.g. one input step) for a spray. When the uses run out the player
 * is back to the fallback weapon (§7), which is ready when the spent weapon's cooldown ends.
 * Check `attackBlocked` first; this refuses the same cases. Read the weapon (and `attackMode`) before
 * calling, since the returned world may already hold fists.
 */
export function useWeapon(
  world: CombatWorld,
  playerId: string,
  weapons: WeaponCatalogue,
  now: number,
  amount = 1,
): CombatResult {
  const blocked = attackBlocked(world, playerId, now);
  if (blocked) return { world, events: [], rejected: blocked };
  const player = findCombatant(world, playerId) as Combatant;
  const def = weapons.require(player.weapon.id);
  const readyAt = now + def.cooldownSeconds;
  if (player.weapon.uses === null) {
    return {
      world: update(world, playerId, (p) => ({ ...p, weapon: { ...p.weapon, readyAt } })),
      events: [],
    };
  }
  const left = player.weapon.uses - amount;
  // Tiny float leftovers from summing spray steps count as empty.
  if (left > 1e-9) {
    return {
      world: update(world, playerId, (p) => ({ ...p, weapon: { ...p.weapon, uses: left, readyAt } })),
      events: [],
    };
  }
  return {
    world: update(world, playerId, (p) => ({ ...p, weapon: fallbackHeld(weapons, readyAt) })),
    events: [{ type: 'weaponSpent', player: playerId, weapon: def.id }],
  };
}

// ── Taking hits ────────────────────────────────────────────────────────────────

/**
 * Why a hit from `source` on `targetId` would not land at `now`, or null if it would. Use it to let
 * projectiles pass through teammates and area effects ignore them (§3.3), and to skip KO'd or
 * spawn-protected players.
 */
export function hitBlocked(
  world: CombatWorld,
  source: HitSource,
  targetId: string,
  now: number,
  allowSelf = false,
): HitRejection | null {
  const target = findCombatant(world, targetId);
  if (!target) return 'unknown_player';
  if (!target.alive) return 'ko';
  if (now < target.protectedUntil) return 'protected';
  if (source.kind === 'player') {
    if (source.id === targetId) return allowSelf ? null : 'self';
    const attacker = findCombatant(world, source.id);
    if (attacker && isFriendly(attacker, target)) return 'friendly';
  }
  return null;
}

export function canHit(
  world: CombatWorld,
  source: HitSource,
  targetId: string,
  now: number,
  allowSelf = false,
): boolean {
  return hitBlocked(world, source, targetId, now, allowSelf) === null;
}

/**
 * Applies one hit: damage, then stun and slow (a longer or stronger effect wins over a weaker one still
 * running). At 0 HP the target is KO'd (§3.3): their weapon is lost (back to fists), effects clear, and
 * they respawn `respawnSeconds` later. Refused hits change nothing.
 */
export function hit(
  world: CombatWorld,
  spec: HitSpec,
  now: number,
  weapons: WeaponCatalogue,
  config: CombatConfig,
): CombatResult {
  const blocked = hitBlocked(world, spec.source, spec.target, now, spec.allowSelf);
  if (blocked) return { world, events: [], rejected: blocked };
  const target = findCombatant(world, spec.target) as Combatant;
  const damage = Math.max(0, spec.damage);
  const hp = Math.max(0, target.hp - damage);
  const weapon = spec.weapon ?? null;
  const events: CombatEvent[] = [
    { type: 'hit', source: spec.source, target: spec.target, damage, weapon, hp },
  ];

  if (hp <= 0) {
    const respawnAt = now + config.respawnSeconds;
    events.push({ type: 'ko', player: spec.target, source: spec.source, weapon, respawnAt });
    return {
      world: update(world, spec.target, (p) => ({
        ...p,
        hp: 0,
        alive: false,
        respawnAt,
        weapon: fallbackHeld(weapons, now),
        stunnedUntil: 0,
        slowMultiplier: 1,
        slowUntil: 0,
      })),
      events,
    };
  }

  return {
    world: update(world, spec.target, (p) => {
      let next: Combatant = { ...p, hp };
      if (spec.stunSeconds && spec.stunSeconds > 0) {
        next = { ...next, stunnedUntil: Math.max(p.stunnedUntil, now + spec.stunSeconds) };
      }
      if (spec.slow && spec.slow.seconds > 0) {
        const running = now < p.slowUntil;
        const until = now + spec.slow.seconds;
        if (!running || spec.slow.multiplier < p.slowMultiplier) {
          next = { ...next, slowMultiplier: spec.slow.multiplier, slowUntil: until };
        } else if (spec.slow.multiplier === p.slowMultiplier) {
          next = { ...next, slowUntil: Math.max(p.slowUntil, until) };
        }
      }
      return next;
    }),
    events,
  };
}

/**
 * Drops the carried item of everyone KO'd in `events` at their position (§3.2, §3.3), with reason `ko`.
 * Players who carry nothing are skipped.
 */
export function dropItemsOnKo(
  items: ItemWorld,
  events: readonly CombatEvent[],
  positionOf: (playerId: string) => Vec2,
  now: number,
): CarryResult {
  let current = items;
  const out: ItemEvent[] = [];
  for (const event of events) {
    if (event.type !== 'ko') continue;
    const dropped = drop(current, event.player, positionOf(event.player), now, 'ko');
    if (dropped.rejected) continue;
    current = dropped.world;
    out.push(...dropped.events);
  }
  return { world: current, events: out };
}

// ── Time-based rules ───────────────────────────────────────────────────────────

/**
 * Brings back every KO'd player whose respawn time has come (§3.3): full HP, fists, spawn protection
 * for `spawnProtectionSeconds`. The server then moves them to their own van (`vanSpawn`).
 */
export function respawnDue(
  world: CombatWorld,
  now: number,
  weapons: WeaponCatalogue,
  config: CombatConfig,
): CombatResult {
  const events: CombatEvent[] = [];
  const players = world.players.map((p) => {
    if (p.alive || p.respawnAt === null || now < p.respawnAt) return p;
    const protectedUntil = now + config.spawnProtectionSeconds;
    events.push({ type: 'respawn', player: p.id, protectedUntil });
    return {
      ...p,
      hp: config.maxHp,
      alive: true,
      respawnAt: null,
      protectedUntil,
      weapon: fallbackHeld(weapons, now),
      stunnedUntil: 0,
      slowMultiplier: 1,
      slowUntil: 0,
    };
  });
  return { world: events.length > 0 ? { players } : world, events };
}

/** Passive regeneration over `dt` seconds for living players, capped at `maxHp` (`hpRegenPerSec`, 0 in v1). */
export function regenerate(world: CombatWorld, dt: number, config: CombatConfig): CombatWorld {
  if (!(config.hpRegenPerSec > 0) || !(dt > 0)) return world;
  return {
    players: world.players.map((p) =>
      p.alive && p.hp < config.maxHp
        ? { ...p, hp: Math.min(config.maxHp, p.hp + config.hpRegenPerSec * dt) }
        : p,
    ),
  };
}

/** True while the player is stunned (no movement, no attacks). */
export function isStunned(player: Combatant, now: number): boolean {
  return now < player.stunnedUntil;
}

/**
 * Speed multiplier from combat state for `StepModifiers.speedMultiplier`: 0 while KO'd or stunned, the
 * slow multiplier while slowed, else 1. Multiply with `carryMultiplier` (and the pan's block speed in
 * M4-6); use the same synced values on server and client prediction.
 */
export function combatSpeedMultiplier(player: Combatant, now: number): number {
  if (!player.alive || isStunned(player, now)) return 0;
  return now < player.slowUntil ? player.slowMultiplier : 1;
}

function update(world: CombatWorld, id: string, fn: (p: Combatant) => Combatant): CombatWorld {
  return { players: world.players.map((p) => (p.id === id ? fn(p) : p)) };
}
