// Pure rules for how combat state looks on a body (M4-2 feedback): KO'd bodies lie on their side and
// fade, spawn-protected ones blink, a hit flashes white. Also the melee swing wedge and the HP bar fill.
import type { MeleeStats } from '@keke/shared';
import type { CombatPlayerView } from '../net/combatView';

export interface CombatLook {
  /** Multiplies the body's opacity. */
  alpha: number;
  /** Body rotation in degrees (90 = lying down). */
  angle: number;
  /** Draw the body white (just hit). */
  flash: boolean;
}

export const NEUTRAL_LOOK: CombatLook = Object.freeze({ alpha: 1, angle: 0, flash: false });

export interface LookConfig {
  koAlpha: number;
  protectedBlinkHz: number;
}

/** `now` and `flashUntil` in seconds on the same clock. */
export function combatLook(
  combat: CombatPlayerView,
  now: number,
  flashUntil: number,
  cfg: LookConfig,
): CombatLook {
  if (!combat.alive) return { alpha: cfg.koAlpha, angle: 90, flash: false };
  const flash = now < flashUntil;
  if (combat.protected) {
    const on = Math.floor(now * cfg.protectedBlinkHz * 2) % 2 === 0;
    return { alpha: on ? 1 : 0.35, angle: 0, flash };
  }
  return flash ? { alpha: 1, angle: 0, flash } : NEUTRAL_LOOK;
}

/** HP bar fill 0..1, or null when it should not show (full HP, KO'd, or not in a round). */
export function hpBarFill(combat: CombatPlayerView, maxHp: number): number | null {
  if (!combat.alive || maxHp <= 0 || combat.hp <= 0 || combat.hp >= maxHp) return null;
  return combat.hp / maxHp;
}

/** Start and end angles (radians) of a melee swing wedge centred on `aim`. */
export function swingAngles(aim: number, stats: Pick<MeleeStats, 'arcDegrees'>): [number, number] {
  const half = (stats.arcDegrees * Math.PI) / 360;
  return [aim - half, aim + half];
}
