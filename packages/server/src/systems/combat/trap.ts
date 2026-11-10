// Trap behaviour (§7, M4-5): banana peels. A press of Attack drops a peel at the thrower's feet (one use).
// After its arm delay, the first rival whose centre comes near it slips: a 0-damage `trap` hit that stuns
// for the slide time, the carried item drops where they slipped, and they slide out of control along
// their movement (walls stop them). Peels nobody steps on vanish after their lifetime (45 s).
// The owner and the owner's teammates never slip on their own peels (rules in @keke/shared rules/trap.ts).
// Peels are synced in `GameState.traps` so clients can draw them; `PlayerState.sliding` marks a slide.
import {
  Button,
  knockbackStep,
  peelExpired,
  placePeel,
  playerHalfSize,
  slipDirection,
  startSlide,
  trippingPeel,
  type AttackMode,
  type Knockback,
  type Peel,
  type TrapStats,
  type WeaponDef,
} from '@keke/shared';
import { TrapState, type GameState } from '../../schema/GameState';
import type { BehaviourModule, CombatContext, FrameIntent } from './types';

/** The trap stats of a weapon that has them. */
export function trapStatsOf(def: WeaponDef | undefined): TrapStats | null {
  return def && def.behaviour === 'trap' ? def.trap : null;
}

/** One trap module per room: it keeps that room's peels and slides. */
export function createTrapBehaviour(state: GameState): BehaviourModule {
  let peels: Peel[] = [];
  const slides = new Map<string, Knockback>();
  let nextId = 1;

  const removePeel = (id: number): void => {
    peels = peels.filter((p) => p.id !== id);
    state.traps.delete(String(id));
  };

  const stopSlide = (id: string): void => {
    slides.delete(id);
    const p = state.players.get(id);
    if (p) p.sliding = false;
  };

  /** Bodies that step on an armed peel slip (one peel each per tick). */
  const trigger = (ctx: CombatContext): void => {
    if (peels.length === 0) return;
    const statsOf = (peel: Peel): TrapStats | null => trapStatsOf(ctx.weapons.get(peel.weapon));
    for (const body of ctx.bodies()) {
      const c = ctx.combatant(body.sessionId);
      if (!c || !c.alive) continue;
      const peel = trippingPeel(
        peels,
        { id: body.sessionId, team: c.team, x: body.x, y: body.y },
        ctx.now,
        statsOf,
      );
      const stats = peel ? statsOf(peel) : null;
      if (!peel || !stats) continue;
      // Protected (or otherwise unhittable) bodies walk over it; the peel stays for the next one.
      const landed = ctx.hit({
        source: { kind: 'player', id: peel.owner },
        target: body.sessionId,
        damage: stats.damage,
        weapon: peel.weapon,
        stunSeconds: stats.slideSeconds,
        delivery: 'trap',
      });
      if (!landed) continue;
      removePeel(peel.id);
      if (stats.dropsCarried) ctx.dropCarried(body.sessionId);
      // A slip while already sliding keeps going the same way (vx/vy are 0 during a slide).
      const current = slides.get(body.sessionId);
      const dir = current ? current.dir : slipDirection({ x: body.vx, y: body.vy }, body.aim);
      const slide = startSlide(dir, stats);
      if (slide && body.alive) {
        slides.set(body.sessionId, slide);
        body.sliding = true;
      }
    }
  };

  const moveSlides = (ctx: CombatContext, dt: number): void => {
    const half = playerHalfSize(ctx.config);
    for (const [id, slide] of [...slides]) {
      const p = ctx.player(id);
      if (!p || !p.alive) {
        stopSlide(id);
        continue;
      }
      const next = knockbackStep(ctx.map.collision, { x: p.x, y: p.y }, half, slide, dt);
      p.x = next.pos.x;
      p.y = next.pos.y;
      p.vx = 0;
      p.vy = 0;
      if (next.knockback) slides.set(id, next.knockback);
      else stopSlide(id);
    }
  };

  return {
    name: 'trap',
    modes: ['trap'],

    onFrame(ctx: CombatContext, intent: FrameIntent, def: WeaponDef, mode: AttackMode): void {
      if (!(intent.pressed & Button.Attack)) return;
      const stats = trapStatsOf(def);
      if (!stats) return;
      const owner = ctx.combatant(intent.player);
      if (!owner || !ctx.use(intent, def, mode)) return;
      const peel = placePeel(
        nextId++,
        def.id,
        { id: intent.player, team: owner.team },
        { x: intent.x, y: intent.y },
        ctx.now,
        stats,
      );
      peels.push(peel);
      const synced = new TrapState();
      synced.id = peel.id;
      synced.weapon = peel.weapon;
      synced.owner = peel.owner;
      synced.team = peel.team;
      synced.x = peel.x;
      synced.y = peel.y;
      synced.armed = stats.armSeconds <= 0;
      state.traps.set(String(peel.id), synced);
    },

    tick(ctx: CombatContext, dt: number): void {
      for (const peel of [...peels]) {
        if (peelExpired(peel, ctx.now)) {
          removePeel(peel.id);
          continue;
        }
        const synced = state.traps.get(String(peel.id));
        if (synced && !synced.armed && ctx.now >= peel.armedAt) synced.armed = true;
      }
      trigger(ctx);
      moveSlides(ctx, dt);
    },

    reset(): void {
      peels = [];
      slides.clear();
      nextId = 1;
      state.traps.clear();
      state.players.forEach((p) => {
        p.sliding = false;
      });
    },

    removePlayer(id: string): void {
      // Their peels stay on the floor (and still spare their old team); only their slide stops.
      stopSlide(id);
    },
  };
}
