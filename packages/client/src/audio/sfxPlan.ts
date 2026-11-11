// Which sound effect a room broadcast or a phase change makes (§12), as pure data. The Game scene turns a
// cue into a volume: full for sounds about us, fading with distance for everyone else's (hearingVolume),
// and plays it through Sfx. Covered: attacks, hits, KOs, respawns, our hits on store workers, pickups,
// drops, deposits, the intro countdown and the end of a round. The wanted alarm, forklift beep and race sounds stay where they are
// (Game.onWanted, drawNpcs, createRace).
import type { AttackMode, RoundPhase } from '@keke/shared';
import type { SfxName } from './names';

/** Where a sound comes from, for its volume. */
export type CueSource =
  /** About us (our attack, a hit on us, our pickup): full volume. */
  | { kind: 'me' }
  /** At a player's drawn body. */
  | { kind: 'player'; id: string }
  /** At a world point. */
  | { kind: 'point'; x: number; y: number }
  /** Not positional (round flow): full volume. */
  | { kind: 'global' };

export interface SoundCue {
  name: SfxName;
  source: CueSource;
}

/** The sound an attack makes, per mode. Replace an entry to give a new behaviour its own sound. */
export const ATTACK_SOUNDS: Readonly<Record<AttackMode, SfxName | null>> = {
  melee: 'swing',
  thrown: 'throw',
  spray: 'spray',
  trap: 'drop',
  shot: 'pop',
  charge: 'swing',
};

/** Weapons whose hit is a splat instead of a punch; banana peels make you slip. */
export const HIT_SOUNDS: Readonly<Record<string, SfxName | null>> = {
  ketchup_bottle: 'splat',
  egg_carton: 'splat',
  soda_bottle: 'splat',
  // The extinguisher's hiss is its spray sound; its hits are silent.
  fire_extinguisher: null,
  banana_peels: 'slip',
};

function bag(message: unknown): Record<string, unknown> | null {
  return typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : null;
}

const about = (id: unknown, me: string): CueSource =>
  id === me ? { kind: 'me' } : typeof id === 'string' ? { kind: 'player', id } : { kind: 'global' };

export interface CombatCueContext {
  me: string;
  /** Whether a player is blocking with the pan right now (a blocked hit clangs). */
  blocking(id: string): boolean;
}

/** Floor hazards by hazard source id (P2-2): the oven sizzles instead of punching. */
export const HAZARD_SOUNDS: Readonly<Record<string, SfxName>> = { oven: 'sizzle' };

/** Cues for a combat broadcast (`attack`, `hit`, `ko`, `respawn`). */
export function combatCues(type: string, message: unknown, ctx: CombatCueContext): SoundCue[] {
  const m = bag(message);
  if (m === null) return [];
  switch (type) {
    case 'attack': {
      const name = ATTACK_SOUNDS[m['mode'] as AttackMode] ?? null;
      if (name === null) return [];
      const source: CueSource =
        m['player'] === ctx.me
          ? { kind: 'me' }
          : typeof m['x'] === 'number' && typeof m['y'] === 'number'
            ? { kind: 'point', x: m['x'], y: m['y'] }
            : about(m['player'], ctx.me);
      return [{ name, source }];
    }
    case 'hit': {
      const target = m['target'];
      if (typeof target !== 'string') return [];
      const weapon = typeof m['weapon'] === 'string' ? m['weapon'] : null;
      const damage = typeof m['damage'] === 'number' ? m['damage'] : 0;
      const source = bag(m['source']);
      const hazard =
        source?.['kind'] === 'hazard' && typeof source['id'] === 'string'
          ? HAZARD_SOUNDS[source['id']]
          : undefined;
      let name: SfxName | null;
      if (hazard !== undefined) name = hazard;
      else if (damage <= 0 && ctx.blocking(target)) name = 'block';
      else if (weapon !== null && weapon in HIT_SOUNDS) name = HIT_SOUNDS[weapon] ?? null;
      else name = 'hit';
      return name === null ? [] : [{ name, source: about(target, ctx.me) }];
    }
    case 'ko':
      return [{ name: 'ko', source: about(m['player'], ctx.me) }];
    case 'respawn':
      // Only our own: other players' respawns happen at their vans, far away and unimportant.
      return m['player'] === ctx.me ? [{ name: 'respawn', source: { kind: 'me' } }] : [];
    default:
      return [];
  }
}

/**
 * Cues for a store worker broadcast (M5): our own hits and knockouts on a worker sound like hits on a
 * player; other players' fights with workers stay quiet (their swings already make a sound).
 */
export function npcCues(type: string, message: unknown, me: string): SoundCue[] {
  const m = bag(message);
  const source = bag(m?.['source']);
  if (m === null || source?.['kind'] !== 'player' || source['id'] !== me) return [];
  if (type === 'npcKo') return [{ name: 'ko', source: { kind: 'me' } }];
  if (type !== 'npcHit') return [];
  const weapon = typeof m['weapon'] === 'string' ? m['weapon'] : null;
  const name = weapon !== null && weapon in HIT_SOUNDS ? (HIT_SOUNDS[weapon] ?? null) : 'hit';
  return name === null ? [] : [{ name, source: { kind: 'me' } }];
}

/** Cues for an item broadcast (`pickup`, `drop`, `deposit`): ours loud, others' by distance. */
export function itemCues(type: string, message: unknown, me: string): SoundCue[] {
  const m = bag(message);
  if (m === null) return [];
  const source = about(m['player'], me);
  switch (type) {
    case 'pickup':
      return [{ name: 'pickup', source }];
    case 'drop':
      return [{ name: 'drop', source }];
    case 'deposit':
      return [{ name: 'deposit', source }];
    default:
      return [];
  }
}

export interface RoundClock {
  phase: RoundPhase;
  /** Whole seconds left in the phase (rounded up, as the intro shows them). */
  seconds: number;
}

/**
 * Round flow cues between two patches: a tick for each of the intro's last three seconds, "go" when the
 * round starts and the buzzer when it ends. `prev` is null for the first patch (nothing plays then, so a
 * reload mid-countdown does not tick twice).
 */
export function roundCues(prev: RoundClock | null, next: RoundClock): SoundCue[] {
  if (prev === null) return [];
  const global: CueSource = { kind: 'global' };
  if (prev.phase === 'countdown' && next.phase === 'playing')
    return [{ name: 'countdownGo', source: global }];
  if (prev.phase === 'playing' && next.phase === 'roundResults')
    return [{ name: 'roundEnd', source: global }];
  if (
    next.phase === 'countdown' &&
    next.seconds >= 1 &&
    next.seconds <= 3 &&
    (prev.phase !== 'countdown' || prev.seconds !== next.seconds)
  ) {
    return [{ name: 'countdown', source: global }];
  }
  return [];
}

/** Shortest gap between two plays of one sound from one source, seconds (spray steps come many a second). */
export const CUE_MIN_GAP_SECONDS: Readonly<Partial<Record<SfxName, number>>> = { spray: 0.25 };
const DEFAULT_MIN_GAP_SECONDS = 0.04;

function sourceKey(source: CueSource): string {
  switch (source.kind) {
    case 'player':
      return `p:${source.id}`;
    case 'point':
      return `xy:${Math.round(source.x / 32)},${Math.round(source.y / 32)}`;
    default:
      return source.kind;
  }
}

/** Drops repeats of one sound from one source that come closer than its minimum gap. */
export class CueGate {
  private readonly last = new Map<string, number>();

  /** True when `cue` may play at `now` (seconds); remembers it. */
  allow(cue: SoundCue, now: number): boolean {
    const key = `${cue.name}|${sourceKey(cue.source)}`;
    const gap = CUE_MIN_GAP_SECONDS[cue.name] ?? DEFAULT_MIN_GAP_SECONDS;
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(key, now);
    return true;
  }
}

/**
 * Combat sounds made by other players (playtest 1: swings and hits were 60% of all sounds and covered the
 * ones about us). Theirs play at this share of their distance volume; ours stay at full volume.
 */
export const OTHERS_COMBAT_VOLUME = 0.5;

const COMBAT_SOUNDS: ReadonlySet<SfxName> = new Set<SfxName>([
  'swing',
  'hit',
  'throw',
  'splat',
  'pop',
  'spray',
  'block',
]);

/** A cue's play volume from its source kind and its distance volume (1 for sounds about us). */
export function cueVolume(name: SfxName, source: CueSource['kind'], distanceVolume: number): number {
  if (source === 'me' || source === 'global') return distanceVolume;
  return COMBAT_SOUNDS.has(name) ? distanceVolume * OTHERS_COMBAT_VOLUME : distanceVolume;
}

/**
 * Sounds that duck the music for a moment when they are about us (played at full volume): our KO, our
 * deposit, our packed box and the winning delivery (playtest 1 idea 10).
 */
export const DUCK_SOUNDS: ReadonlySet<SfxName> = new Set<SfxName>(['ko', 'deposit', 'boxPacked', 'delivery']);

/** Plays at or above this volume count as "about us" for ducking. */
export const DUCK_MIN_VOLUME = 0.95;

export function ducksMusic(name: SfxName, volume: number): boolean {
  return volume >= DUCK_MIN_VOLUME && DUCK_SOUNDS.has(name);
}
