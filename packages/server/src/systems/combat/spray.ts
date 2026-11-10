// Spray behaviour (§7, M4-4): the ketchup bottle (short cone, damage and slow) and the fire extinguisher
// (wide cone, strong push, vision cloud). Holding Attack sprays. The spray works in damage ticks of
// `tickSeconds` on the round clock: the first tick fires as soon as Attack is held, then one every
// `tickSeconds` while it stays held (tapping cannot fire faster). Each tick spends `tickSeconds` of the
// weapon's spray seconds (one `attack` broadcast per tick, which clients draw the spray and cloud from)
// and reaches every body in the cone that a wall does not hide.
//
// Weapons that deal damage or slow land a `hit` (delivery 'spray') with the push as its knockback;
// push-only sprays (the extinguisher) shove without a hit, so the feed is not flooded with 0-damage hits.
// The vision cloud is purely visual: clients place it with the shared `sprayCloud` from each tick's
// `attack` event, so the server keeps no cloud state.
import {
  Button,
  knockbackDirection,
  sprayPushPx,
  sprayTargets,
  sprayTickDue,
  type AttackMode,
  type WeaponDef,
} from '@keke/shared';
import type { BehaviourModule, CombatContext, FrameIntent } from './types';

/** A spray module for one CombatSystem (it keeps per-room state, so never share one between rooms). */
export function createSprayBehaviour(): BehaviourModule {
  /** Round-clock time each player's next spray tick may fire (kept across releases, so taps are capped). */
  const nextTickAt = new Map<string, number>();
  return {
    name: 'spray',
    modes: ['spray'],
    onFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void {
      if (!(intent.held & Button.Attack) || def.behaviour !== 'spray') return;
      const stats = def.spray;
      if (!sprayTickDue(nextTickAt.get(intent.player), ctx.now)) return;
      if (!ctx.use(intent, def, mode, stats.tickSeconds)) return;
      nextTickAt.set(intent.player, ctx.now + stats.tickSeconds);

      const source = { kind: 'player', id: intent.player } as const;
      const origin = { x: intent.x, y: intent.y };
      const candidates = ctx.targets(source);
      const pushPx = sprayPushPx(stats);
      const ids = sprayTargets(origin, intent.aim, candidates, stats, ctx.bodyRadius, ctx.map.collision);
      for (const id of ids) {
        const target = ctx.position(id);
        if (!target) continue;
        const dir = knockbackDirection(origin, target, intent.aim);
        if (stats.damagePerTick > 0 || stats.slow) {
          ctx.hit({
            source,
            target: id,
            damage: stats.damagePerTick,
            weapon: def.id,
            ...(stats.slow ? { slow: stats.slow } : {}),
            delivery: 'spray',
            ...(pushPx > 0 ? { knockback: { dir, px: pushPx } } : {}),
          });
        } else if (pushPx > 0) {
          ctx.push(id, dir, pushPx);
        }
      }
    },
    reset(): void {
      nextTickAt.clear();
    },
    removePlayer(id: string): void {
      nextTickAt.delete(id);
    },
  };
}
