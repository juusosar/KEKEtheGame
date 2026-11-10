// Thrown behaviour (§7, M4-3): egg carton and shaken soda bottle. One press of Attack throws one from the
// thrower's centre along the aim; the ProjectileSystem flies it and lands the hit, the egg splash
// (r = 32 px) or the soda fizz burst with its area knockback (r = 64 px). All numbers are in weapons.json.
import { Button, type AttackMode, type WeaponDef } from '@keke/shared';
import type { ProjectileSystem } from './projectiles';
import type { BehaviourModule, CombatContext, FrameIntent } from './types';

export function thrownBehaviour(projectiles: ProjectileSystem): BehaviourModule {
  return {
    name: 'thrown',
    modes: ['thrown'],
    onFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void {
      if (!(intent.pressed & Button.Attack)) return;
      if (def.behaviour !== 'thrown') return;
      if (!ctx.use(intent, def, mode)) return;
      projectiles.spawn({
        owner: intent.player,
        weapon: def.id,
        x: intent.x,
        y: intent.y,
        aim: intent.aim,
        stats: def.projectile,
      });
    },
  };
}
