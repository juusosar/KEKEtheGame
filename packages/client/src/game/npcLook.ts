// Pure rules for how a store worker looks (M5-7): which animation of its sheet plays, whether it flashes,
// fades, shows the hostile mark or the forklift warning light, and when a forklift beeps. Keyed only on
// the synced NpcState fields (type, behaviour, moving, alive, mode, target), so a new behaviour module
// (guard, forklift, butcher) shows up drawn without client changes. npcs.ts draws the result.
import type { MeleeStats, NpcDef, Vec2 } from '@keke/shared';
import type { NpcView } from '../net/npcView';
import { facingFromMove, type Facing } from './facing';

/** Facing from an aim angle (radians, 0 = +x, y down). */
export function facingFromAim(aim: number, previous: Facing): Facing {
  if (!Number.isFinite(aim)) return previous;
  return facingFromMove({ x: Math.cos(aim), y: Math.sin(aim) }, previous);
}

export interface NpcLookInput {
  npc: NpcView;
  /** The atlas key (npcs.json `sprite`, the type id by default). */
  sheet: string;
  facing: Facing;
  /** Scene seconds. */
  now: number;
  /** Until when the swing pose shows (an `npcAttack` arrived), scene seconds. */
  attackUntil: number;
  /** Until when the body flashes white (an `npcHit` with damage arrived), scene seconds. */
  flashUntil: number;
  /**
   * The round is in its playing phase. NPCs tick only then (M5 review F3): outside it forklifts stand
   * parked, so their light is off. Default true.
   */
  playing?: boolean;
}

export interface NpcLook {
  /** Animation key `<sheet>/<anim>_<dir>`. */
  anim: string;
  alpha: number;
  flash: boolean;
  /** Draw the red anger mark: the NPC is after someone (stocker retaliating, guard chasing). */
  hostile: boolean;
  /** Draw the yellow fright mark: a customer panicking (Phase 2 decision 8; P2-4). */
  alarmed: boolean;
  /** Forklift warning light on. */
  light: boolean;
  /** Show the small HP bar (hurt, not invulnerable, up). */
  hpFill: number | null;
}

/** Synced `mode` of a panicking customer (server systems/npcs/customer.ts). */
export const PANIC_MODE = 'panic';

/**
 * True when a customer just started to panic (P2-4): the gasp plays and the fright mark pops. A panic
 * that restarts while running (new violence) is not a new start.
 */
export function panicStarted(
  previousMode: string | undefined,
  npc: Pick<NpcView, 'mode' | 'alive'>,
): boolean {
  return npc.alive && npc.mode === PANIC_MODE && previousMode !== undefined && previousMode !== PANIC_MODE;
}

/**
 * Which sheet an NPC is drawn with (P2-4): its base sheet or one of the look variants the art tool makes
 * (`<sheet>_2`, `<sheet>_3`, ...; tools/art/characters.ts NPC_VARIANTS), picked by the number in its id
 * so every client draws the same NPC alike and a group's members differ. Variants stop at the first
 * missing key.
 */
export function npcSheetVariant(id: string, sheet: string, exists: (key: string) => boolean): string {
  const looks = [sheet];
  for (let n = 2; exists(`${sheet}_${n}`); n++) looks.push(`${sheet}_${n}`);
  const match = /(\d+)$/.exec(id);
  const index = match ? Number(match[1]) - 1 : 0;
  return looks[((index % looks.length) + looks.length) % looks.length] ?? sheet;
}

/** Opacity of a KO'd worker lying where it fell. */
export const NPC_KO_ALPHA = 0.6;

export function npcLook(input: NpcLookInput, sheetHasAnims: (key: string) => boolean): NpcLook {
  const { npc, sheet, facing, now } = input;
  const flash = npc.alive && now < input.flashUntil;
  if (npc.behaviour === 'forklift') {
    // 64 × 32 sheet with drive_<dir> only (§11.1). The light runs whenever the forklift is out in play.
    return {
      anim: `${sheet}/drive_${facing}`,
      alpha: 1,
      flash: false,
      hostile: false,
      alarmed: false,
      light: npc.alive && input.playing !== false,
      hpFill: null,
    };
  }
  let anim: string;
  if (!npc.alive) anim = 'ko';
  else if (now < input.attackUntil) anim = 'attack';
  else if (flash) anim = 'hit';
  else anim = npc.moving ? 'walk' : 'idle';
  let key = `${sheet}/${anim}_${facing}`;
  // A sheet that lacks a pose falls back to idle (real art may ship fewer poses).
  if (!sheetHasAnims(key)) key = `${sheet}/idle_${facing}`;
  const hurt = npc.maxHp > 0 && npc.alive && npc.hp > 0 && npc.hp < npc.maxHp;
  return {
    anim: key,
    alpha: npc.alive ? 1 : NPC_KO_ALPHA,
    flash,
    hostile: npc.alive && npc.target !== '',
    alarmed: npc.alive && npc.mode === PANIC_MODE,
    light: false,
    hpFill: hurt ? npc.hp / npc.maxHp : null,
  };
}

/** The melee an NPC type swings with (npcAttack wedge size), or null when it has none (forklift). */
export function npcMelee(def: NpcDef | undefined): Pick<MeleeStats, 'rangePx' | 'arcDegrees'> | null {
  if (!def) return null;
  if (def.behaviour === 'stocker') return def.retaliation?.melee ?? null;
  if (def.behaviour === 'security' || def.behaviour === 'butcher') return def.attack.melee;
  return null;
}

/**
 * Whether a forklift's reversing beep runs (M5-5 modes): while it drives ('drive') and while it waits
 * for a stock cart ('blocked'), not during the corner stop. Other modes fall back to `moving`. Never
 * outside the playing phase (M5 review F3): NPCs do not tick then, so the mode stays 'drive' through
 * the countdown and freezes through the results and podium.
 */
export function forkliftBeeping(npc: Pick<NpcView, 'mode' | 'moving' | 'alive'>, playing: boolean): boolean {
  if (!npc.alive || !playing) return false;
  if (npc.mode === 'drive' || npc.mode === 'blocked') return true;
  if (npc.mode === 'corner' || npc.mode === 'idle') return false;
  return npc.moving;
}

/**
 * Whether a forklift beeps this frame: every `interval` seconds while it drives. `last` is when it last
 * beeped (−Infinity before the first). Returns the new `last` when it beeps, or null.
 */
export function forkliftBeepDue(moving: boolean, last: number, now: number, interval: number): number | null {
  if (!moving || interval <= 0) return null;
  return now - last >= interval ? now : null;
}

/** Volume 0..1 of a sound at `source` heard from `listener`: full up close, silent at `rangePx`. */
export function hearingVolume(source: Vec2, listener: Vec2 | null, rangePx: number): number {
  if (listener === null || rangePx <= 0) return 0;
  const d = Math.hypot(source.x - listener.x, source.y - listener.y);
  return Math.max(0, Math.min(1, 1 - d / rangePx));
}

/** Readable NPC type from its id (`stocker_2` → `stocker`) when the synced type is not known yet. */
export function npcTypeFromId(id: string): string {
  const cut = id.lastIndexOf('_');
  return cut > 0 && /^\d+$/.test(id.slice(cut + 1)) ? id.slice(0, cut) : id;
}
