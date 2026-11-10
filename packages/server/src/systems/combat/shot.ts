// Shot behaviour (§7; M4-6): the champagne bottle's cork. While the bottle has shot uses left (attackMode
// 'shot'), one press of Attack pops the cork: a long-range single-target projectile through the shared
// ProjectileSystem (default impact: `shot.damage` and a shove along the flight). Once the cork is spent the
// same bottle is a melee weapon, which melee.ts swings.
import { Button, type AttackMode, type WeaponDef } from '@keke/shared';
import type { ProjectileSystem } from './projectiles';
import type { BehaviourModule, CombatContext, FrameIntent } from './types';

export function shotBehaviour(projectiles: ProjectileSystem): BehaviourModule {
  return {
    name: 'shot',
    modes: ['shot'],
    onFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void {
      if (!(intent.pressed & Button.Attack)) return;
      if (def.behaviour !== 'shot_then_melee') return;
      if (!ctx.use(intent, def, mode)) return;
      projectiles.spawn({
        owner: intent.player,
        weapon: def.id,
        x: intent.x,
        y: intent.y,
        aim: intent.aim,
        stats: def.shot,
      });
    },
  };
}
