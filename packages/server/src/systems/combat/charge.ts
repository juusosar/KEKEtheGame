// Charge behaviour (§7; M4-6): the pallet jack. One press of Attack spends a charge and dashes the
// holder `distanceTiles` along the aim at `speedPxPerSecond`. Input does not move a charging body (the
// synced `charging` flag zeroes its walk speed, server and prediction alike). Every body the dash's band
// (`widthPx`) sweeps over is hit once: damage, knocked down (stun `knockdownSeconds`) and flung forward
// and aside. Lying items in the band scatter `scatterPx` out of the line. A wall, a stun or a KO ends the
// dash early. NPCs in the line are hit the same way (M5-3).
import {
  Button,
  chargeKnockbackDirection,
  moveAabb,
  playerHalfSize,
  sweepTargets,
  type AttackMode,
  type ChargeStats,
  type Vec2,
  type WeaponDef,
} from '@keke/shared';
import type { PlayerState } from '../../schema/GameState';
import type { BehaviourModule, CombatContext, FrameIntent } from './types';

interface Dash {
  readonly player: PlayerState;
  readonly weapon: string;
  readonly stats: ChargeStats;
  readonly dir: Vec2;
  /** Pixels still to go. */
  left: number;
  /** Bodies already hit by this dash. */
  readonly hit: Set<string>;
}

export function createChargeBehaviour(): BehaviourModule {
  const dashes = new Map<string, Dash>();

  function end(id: string): void {
    const dash = dashes.get(id);
    if (!dash) return;
    dashes.delete(id);
    dash.player.charging = false;
  }

  function step(ctx: CombatContext, id: string, dash: Dash, dt: number): void {
    const c = ctx.combatant(id);
    const p = ctx.player(id);
    if (!c || !p || !c.alive || ctx.now < c.stunnedUntil) return end(id);
    const want = Math.min(dash.left, dash.stats.speedPxPerSecond * dt);
    const from = { x: p.x, y: p.y };
    const moved = moveAabb(ctx.map.collision, from, playerHalfSize(ctx.config), {
      x: dash.dir.x * want,
      y: dash.dir.y * want,
    });
    p.x = moved.x;
    p.y = moved.y;
    p.vx = 0;
    p.vy = 0;
    dash.left -= want;
    const to = { x: p.x, y: p.y };

    const source = { kind: 'player', id } as const;
    const halfWidth = dash.stats.widthPx / 2;
    // Players and store workers alike (§7: "knocks down everything in its line"; M5-3).
    const candidates = ctx
      .targets(source)
      .filter((b) => !dash.hit.has(b.id))
      .map((b) => ({ id: b.id, x: b.x, y: b.y }));
    for (const target of sweepTargets(from, to, halfWidth + ctx.bodyRadius, candidates)) {
      const body = ctx.position(target);
      if (!body) continue;
      dash.hit.add(target);
      ctx.hit({
        source,
        target,
        damage: dash.stats.damage,
        weapon: dash.weapon,
        stunSeconds: dash.stats.knockdownSeconds,
        delivery: 'charge',
        knockback: { dir: chargeKnockbackDirection(from, dash.dir, body), px: dash.stats.knockbackPx },
      });
    }
    if (dash.stats.scattersItems) ctx.scatterItems(from, to, halfWidth, dash.stats.scatterPx);

    if (dash.left <= 1e-6 || moved.hitX || moved.hitY) end(id);
  }

  return {
    name: 'charge',
    modes: ['charge'],
    onFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void {
      if (!(intent.pressed & Button.Attack) || def.behaviour !== 'charge') return;
      if (dashes.has(intent.player)) return;
      const player = ctx.player(intent.player);
      if (!player) return;
      if (!ctx.use(intent, def, mode)) return;
      dashes.set(intent.player, {
        player,
        weapon: def.id,
        stats: def.charge,
        dir: { x: Math.cos(intent.aim), y: Math.sin(intent.aim) },
        left: def.charge.distanceTiles * ctx.map.collision.tileSize,
        hit: new Set(),
      });
      player.charging = true;
    },
    tick(ctx: CombatContext, dt: number): void {
      for (const [id, dash] of [...dashes]) step(ctx, id, dash, dt);
    },
    reset(): void {
      for (const id of [...dashes.keys()]) end(id);
    },
    removePlayer(id: string): void {
      end(id);
    },
  };
}
