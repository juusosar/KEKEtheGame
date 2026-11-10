// Pure rule for predicting our own attack on the press (M4-7, M4 review F1): the held weapon swings at
// once instead of a round trip later, but only when the server will accept the attack. combatFx.ts
// applies it and counts predicted swings for the debug hook (`__KEKE__.swings()`).
import { attackMode, type AttackMode, type WeaponDef } from '@keke/shared';
import type { CombatPlayerView } from '../net/combatView';

/**
 * The attack mode our press starts, or null when it does not swing: KO'd, stunned, still in the
 * weapon's cooldown (`readyAt`), an unknown weapon, or a spray (sprays run while held and the server's
 * per-step attack events animate them).
 */
export function predictedSwingMode(
  combat: Pick<CombatPlayerView, 'alive' | 'stunned' | 'uses'>,
  def: WeaponDef | undefined,
  now: number,
  readyAt: number,
): AttackMode | null {
  if (!combat.alive || combat.stunned || now < readyAt || !def) return null;
  const mode = attackMode(def, combat.uses);
  return mode === 'spray' ? null : mode;
}
