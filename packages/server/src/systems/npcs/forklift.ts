// Forklift (§8; M5-5): drives its own `forklift_routes` loop (one route per forklift from planNpcs,
// `placement.routeIndex`) at `speedPxPerSecond`, from corner to corner, and stops `cornerStopSeconds` at
// every corner. It is invulnerable (hp null: weapons pass through it). While it drives, any round player
// its body touches is run over: `contact.damage`, knocked down (stun) for `contact.knockdownSeconds`,
// thrown `contact.knockbackPx` out of its lane, and (with `contact.dropsCarried`) made to drop what they
// carry (DropReason 'forklift'). The same player is not hit again by the same forklift for
// `contact.hitCooldownSeconds`. A stock cart parked on the route makes it wait until the cart is gone.
//
// Synced `mode`: 'drive' (moving to the next corner: warning light on, beep every
// `warning.beepIntervalSeconds`), 'corner' (stopped at a corner: light on, no beep), 'blocked' (waiting
// behind a stock cart parked on its route: light on, beep). `target` stays ''. The client takes the
// beep period and light radius from npcs.json (`warning`); no extra events are sent (see the M5-5 handoff).
import type { NpcOf, Vec2 } from '@keke/shared';
import type { Npc, NpcBehaviourModule, NpcContext } from './types';

interface Memory {
  /** Index into the route's points of the corner it is driving to. */
  next: number;
  /** Stopped at a corner until this round time; null while driving. */
  stopUntil: number | null;
  /** Round time each player can be hit again by this forklift. */
  readonly hitAgainAt: Map<string, number>;
}

/** Closer than this to a corner counts as there (moveAabb can leave a sub-pixel gap). */
const ARRIVE_PX = 0.5;
/** Overlap needed for contact, in pixels: grazing a corner of the body does not count. */
const CONTACT_SLOP_PX = 1;

function defOf(npc: Npc): NpcOf<'forklift'> {
  if (npc.def.behaviour !== 'forklift') throw new Error(`forklift module got a ${npc.def.behaviour}`);
  return npc.def;
}

function routeOf(ctx: NpcContext, npc: Npc): readonly Vec2[] {
  const index = npc.placement.routeIndex;
  return (index === null ? undefined : ctx.map.forkliftRoutes[index]?.points) ?? [];
}

/**
 * Direction a run-over player is thrown: mostly sideways out of the lane, on the side they already stand,
 * a little forward. Straight ahead would leave them in the lane to be hit again.
 */
export function forkliftThrowDir(forward: Vec2, from: Vec2, to: Vec2): Vec2 {
  const len = Math.hypot(forward.x, forward.y);
  const f = len > 1e-6 ? { x: forward.x / len, y: forward.y / len } : { x: 1, y: 0 };
  // Left-hand normal; pick the side of the lane the player's centre is on (left when dead centre).
  const side = { x: f.y, y: -f.x };
  const across = (to.x - from.x) * side.x + (to.y - from.y) * side.y;
  const s = across < 0 ? -1 : 1;
  const dir = { x: side.x * s + f.x * 0.5, y: side.y * s + f.y * 0.5 };
  const d = Math.hypot(dir.x, dir.y);
  return { x: dir.x / d, y: dir.y / d };
}

export function createForkliftBehaviour(): NpcBehaviourModule {
  const memory = new Map<string, Memory>();

  function fresh(ctx: NpcContext, npc: Npc): Memory {
    const route = routeOf(ctx, npc);
    // Spawned on point 0 (planNpcs): head for point 1.
    const m: Memory = { next: route.length > 1 ? 1 : 0, stopUntil: null, hitAgainAt: new Map() };
    memory.set(npc.id, m);
    return m;
  }

  /** Runs over every round player the body touches this tick (only while it moves). */
  function contact(ctx: NpcContext, npc: Npc, def: NpcOf<'forklift'>, m: Memory, forward: Vec2): void {
    const c = def.contact;
    const reachX = npc.half.hw + ctx.config.playerHitboxSize / 2 - CONTACT_SLOP_PX;
    const reachY = npc.half.hh + ctx.config.playerHitboxSize / 2 - CONTACT_SLOP_PX;
    for (const p of ctx.players()) {
      if (Math.abs(p.x - npc.state.x) >= reachX || Math.abs(p.y - npc.state.y) >= reachY) continue;
      if (ctx.now < (m.hitAgainAt.get(p.sessionId) ?? 0)) continue;
      m.hitAgainAt.set(p.sessionId, ctx.now + c.hitCooldownSeconds);
      const landed = ctx.hitPlayer({
        source: { kind: 'hazard', id: npc.id },
        target: p.sessionId,
        damage: c.damage,
        stunSeconds: c.knockdownSeconds,
        // Not melee: a raised pan does not stop a forklift.
        delivery: 'charge',
        knockback: { dir: forkliftThrowDir(forward, npc.state, p), px: c.knockbackPx },
      });
      // A KO already dropped the item ('ko'); dropCarried ignores players who are down.
      if (landed && c.dropsCarried) ctx.dropCarried(p.sessionId, 'forklift');
    }
  }

  return {
    behaviour: 'forklift',
    spawn(ctx: NpcContext, npc: Npc): void {
      fresh(ctx, npc);
      npc.state.mode = 'drive';
      npc.state.target = '';
    },
    tick(ctx: NpcContext, npc: Npc, dt: number): void {
      const def = defOf(npc);
      const m = memory.get(npc.id) ?? fresh(ctx, npc);
      const route = routeOf(ctx, npc);
      const goal = route[m.next];
      if (route.length < 2 || !goal) {
        npc.state.mode = 'idle';
        return;
      }
      if (m.stopUntil !== null) {
        if (ctx.now < m.stopUntil) {
          npc.state.mode = 'corner';
          return;
        }
        m.stopUntil = null;
      }
      const dx = goal.x - npc.state.x;
      const dy = goal.y - npc.state.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(0, def.speedPxPerSecond) * dt;
      const forward =
        dist > 1e-6
          ? { x: dx / dist, y: dy / dist }
          : { x: Math.cos(npc.state.aim), y: Math.sin(npc.state.aim) };
      const delta = dist <= step ? { x: dx, y: dy } : { x: forward.x * step, y: forward.y * step };
      const before = { x: npc.state.x, y: npc.state.y };
      ctx.moveBy(npc, delta);
      const moved = Math.hypot(npc.state.x - before.x, npc.state.y - before.y);
      if (Math.hypot(goal.x - npc.state.x, goal.y - npc.state.y) <= ARRIVE_PX) {
        m.next = (m.next + 1) % route.length;
        m.stopUntil = def.cornerStopSeconds > 0 ? ctx.now + def.cornerStopSeconds : null;
        npc.state.mode = m.stopUntil === null ? 'drive' : 'corner';
      } else {
        // Less than a tenth of a step: a stock cart (or a wall it was nudged into) is in the way.
        npc.state.mode = moved < step * 0.1 ? 'blocked' : 'drive';
      }
      if (moved > 1e-6) contact(ctx, npc, def, m, forward);
    },
    removePlayer(id: string): void {
      for (const m of memory.values()) m.hitAgainAt.delete(id);
    },
    reset(): void {
      memory.clear();
    },
  };
}
