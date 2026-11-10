// Melee behaviour (§7, M4-2): fists, baguette, frozen salmon, rolling pin, the pan's swing and the
// champagne bottle after its cork. One press of Attack = one swing: every body in the arc in front of the
// attacker takes the weapon's damage and stun and is shoved straight away from the attacker.
import {
  Button,
  knockbackDirection,
  meleeTargets,
  type AttackMode,
  type MeleeStats,
  type WeaponDef,
} from '@keke/shared';
import type { BehaviourModule, CombatContext, FrameIntent } from './types';

/** The melee stats of a weapon that has them (melee, and shot_then_melee once the shot is spent). */
export function meleeStatsOf(def: WeaponDef): MeleeStats | null {
  return 'melee' in def ? def.melee : null;
}

export const meleeBehaviour: BehaviourModule = {
  name: 'melee',
  modes: ['melee'],
  onFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void {
    if (!(intent.pressed & Button.Attack)) return;
    const stats = meleeStatsOf(def);
    if (!stats) return;
    if (!ctx.use(intent, def, mode)) return;
    const source = { kind: 'player', id: intent.player } as const;
    const origin = { x: intent.x, y: intent.y };
    const candidates = ctx
      .bodies()
      .filter((p) => ctx.canHit(source, p.sessionId))
      .map((p) => ({ id: p.sessionId, x: p.x, y: p.y }));
    for (const id of meleeTargets(origin, intent.aim, candidates, stats, ctx.bodyRadius)) {
      const target = ctx.player(id);
      if (!target) continue;
      ctx.hit({
        source,
        target: id,
        damage: stats.damage,
        weapon: def.id,
        stunSeconds: stats.stunSeconds,
        delivery: 'melee',
        knockback: { dir: knockbackDirection(origin, target, intent.aim), px: stats.knockbackPx },
      });
    }
  },
};
