// Block modifier (§7, §13.3; M4-6): holding Block with a weapon that has `block` stats (the cast-iron
// pan) raises it. While raised the holder moves at `block.moveSpeedMultiplier` (CombatSystem reads the
// synced `blocking` flag), cannot attack, and takes melee hits at `block.meleeDamageMultiplier` damage
// and knockback with no stun. Projectile reflection is added with the projectile system (M4-3).
// The block faces every way: §7 only says "hold block".
import { Button, type WeaponDef } from '@keke/shared';
import type { BehaviourModule, CombatContext, CombatHit, FrameIntent } from './types';

/** True when `id` may raise a block now: alive, not stunned, and holding a weapon that blocks. */
function canBlock(ctx: CombatContext, id: string, def: WeaponDef | undefined): boolean {
  const c = ctx.combatant(id);
  return !!def?.block && !!c && c.alive && !(ctx.now < c.stunnedUntil);
}

export function createBlockBehaviour(): BehaviourModule {
  return {
    name: 'block',
    modes: [],
    onAnyFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef): boolean {
      const player = ctx.player(intent.player);
      if (!player) return false;
      const blocking = (intent.held & Button.Block) !== 0 && canBlock(ctx, intent.player, def);
      if (player.blocking !== blocking) player.blocking = blocking;
      // A raised pan takes the frame: no swing while blocking.
      return blocking;
    },
    tick(ctx: CombatContext): void {
      // Lower the pan when its holder lost it (pickup rolled another weapon, spent), got stunned or KO'd
      // in a tick without an input frame.
      for (const p of ctx.bodies()) {
        if (p.blocking && !canBlock(ctx, p.sessionId, ctx.weapons.get(p.weapon))) p.blocking = false;
      }
    },
    adjustHit(ctx: CombatContext, hit: CombatHit): CombatHit | null {
      if (hit.delivery !== 'melee') return hit;
      const target = ctx.player(hit.target);
      if (!target?.blocking) return hit;
      const block = ctx.weapons.get(target.weapon)?.block;
      if (!block) return hit;
      const k = block.meleeDamageMultiplier;
      const softened: CombatHit = { ...hit, damage: hit.damage * k, stunSeconds: 0 };
      return hit.knockback
        ? { ...softened, knockback: { dir: hit.knockback.dir, px: hit.knockback.px * k } }
        : softened;
    },
  };
}
