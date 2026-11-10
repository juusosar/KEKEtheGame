// NPC health (§8; M5-3): HP, hits, KO, the respawn timer, stun and slow for store workers. Pure and
// immutable like combat.ts, but NPCs are not in the CombatWorld: they have no team, no weapon and no spawn
// protection, can be invulnerable (forklift, hp null) and come back after `npcRespawnSeconds`, not
// `respawnSeconds`. `now` is the round clock in seconds.
import type { GameConfig } from '../config';
import type { HitSource } from './combat';

export interface NpcVitals {
  /** Current HP; null = invulnerable (never hit, never KO'd). */
  readonly hp: number | null;
  readonly maxHp: number | null;
  readonly alive: boolean;
  /** Round time of the respawn; set only while KO'd. */
  readonly respawnAt: number | null;
  /** Does not move or attack before this round time (knockdown, stun). */
  readonly stunnedUntil: number;
  readonly slowMultiplier: number;
  readonly slowUntil: number;
}

export interface NpcHitSpec {
  readonly source: HitSource;
  readonly damage: number;
  readonly stunSeconds?: number;
  readonly slow?: { readonly multiplier: number; readonly seconds: number };
}

export interface NpcHitResult {
  readonly vitals: NpcVitals;
  /** False when the hit could not land (KO'd, invulnerable, an NPC hitting itself). */
  readonly landed: boolean;
  /** True when this hit took the last HP. */
  readonly ko: boolean;
}

/** Full HP, up, nothing running. `hp` null = invulnerable. */
export function freshNpcVitals(hp: number | null): NpcVitals {
  return {
    hp,
    maxHp: hp,
    alive: true,
    respawnAt: null,
    stunnedUntil: 0,
    slowMultiplier: 1,
    slowUntil: 0,
  };
}

/** Whether a hit from `source` can land on NPC `npcId` now. */
export function npcCanBeHit(vitals: NpcVitals, source: HitSource, npcId: string): boolean {
  if (!vitals.alive || vitals.hp === null) return false;
  return !(source.kind === 'npc' && source.id === npcId);
}

/** Applies one hit: damage, stun (the longer one wins), slow; KO at 0 HP starts the respawn timer. */
export function hitNpc(
  vitals: NpcVitals,
  npcId: string,
  hit: NpcHitSpec,
  now: number,
  config: Pick<GameConfig, 'npcRespawnSeconds'>,
): NpcHitResult {
  if (!npcCanBeHit(vitals, hit.source, npcId) || vitals.hp === null) {
    return { vitals, landed: false, ko: false };
  }
  const hp = Math.max(0, vitals.hp - Math.max(0, hit.damage));
  if (hp <= 0) {
    return {
      vitals: {
        ...vitals,
        hp: 0,
        alive: false,
        respawnAt: now + config.npcRespawnSeconds,
        stunnedUntil: 0,
        slowMultiplier: 1,
        slowUntil: 0,
      },
      landed: true,
      ko: true,
    };
  }
  const stunSeconds = hit.stunSeconds ?? 0;
  const stunnedUntil =
    stunSeconds > 0 ? Math.max(vitals.stunnedUntil, now + stunSeconds) : vitals.stunnedUntil;
  const slowed = hit.slow !== undefined && hit.slow.seconds > 0;
  return {
    vitals: {
      ...vitals,
      hp,
      stunnedUntil,
      slowMultiplier: slowed ? (hit.slow?.multiplier ?? 1) : vitals.slowMultiplier,
      slowUntil: slowed ? now + (hit.slow?.seconds ?? 0) : vitals.slowUntil,
    },
    landed: true,
    ko: false,
  };
}

/** True when a KO'd NPC's respawn time has come. */
export function npcRespawnDue(vitals: NpcVitals, now: number): boolean {
  return !vitals.alive && vitals.respawnAt !== null && now >= vitals.respawnAt;
}

/** Whole seconds to the respawn while KO'd (rounded up), 0 while up. */
export function npcRespawnIn(vitals: NpcVitals, now: number): number {
  return !vitals.alive && vitals.respawnAt !== null ? Math.max(0, Math.ceil(vitals.respawnAt - now)) : 0;
}

export function npcStunned(vitals: NpcVitals, now: number): boolean {
  return vitals.alive && now < vitals.stunnedUntil;
}

/** Walk speed multiplier: 0 while KO'd or stunned, the slow while it runs, else 1. */
export function npcSpeedMultiplier(vitals: NpcVitals, now: number): number {
  if (!vitals.alive || now < vitals.stunnedUntil) return 0;
  return now < vitals.slowUntil ? vitals.slowMultiplier : 1;
}
