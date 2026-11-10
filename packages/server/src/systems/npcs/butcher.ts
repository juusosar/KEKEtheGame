// Butcher (§8; M5-6): stays at the meat & fish counter and attacks anyone inside the `guardZone`
// (`behind_counter`) with a cleaver (`attack.melee`, 20 damage) on `attack.cooldownSeconds`. It ignores
// everyone else: it does not retaliate when hit and its swings only land on players standing in the guard
// zone. It chases the intruder nearest to it (sticking with its current one while they stay inside) and
// never leaves its `homeZone` (`meat_fish`): if it ever finds itself outside, it walks back to its spawn
// before doing anything else. With nobody behind the counter it walks back to its spawn and waits there.
// Synced `mode`: 'idle' (at its post), 'attack' (after an intruder), 'return' (walking back to its post).
import type { NpcOf, Vec2 } from '@keke/shared';
import type { PlayerState } from '../../schema/GameState';
import type { Npc, NpcBehaviourModule, NpcContext } from './types';

/** How close to its spawn counts as being back at its post, pixels. */
const POST_RADIUS = 4;

interface Memory {
  /** Round time its next swing is allowed. */
  nextSwingAt: number;
}

function defOf(npc: Npc): NpcOf<'butcher'> {
  if (npc.def.behaviour !== 'butcher') throw new Error(`butcher module got a ${npc.def.behaviour}`);
  return npc.def;
}

/** True when the point is in the butcher's home (the guard zone sits inside the home zone). */
function atHome(ctx: NpcContext, def: NpcOf<'butcher'>, at: Vec2): boolean {
  const id = ctx.map.zoneAt(at.x, at.y)?.id;
  return id === def.homeZone || id === def.guardZone;
}

/** Up players standing in the guard zone, in join order. */
function intruders(ctx: NpcContext, def: NpcOf<'butcher'>): PlayerState[] {
  return ctx.players().filter((p) => ctx.map.zoneAt(p.x, p.y)?.id === def.guardZone);
}

export function createButcherBehaviour(): NpcBehaviourModule {
  const memory = new Map<string, Memory>();

  function mem(npc: Npc): Memory {
    let m = memory.get(npc.id);
    if (!m) {
      m = { nextSwingAt: 0 };
      memory.set(npc.id, m);
    }
    return m;
  }

  function goHome(ctx: NpcContext, npc: Npc, def: NpcOf<'butcher'>): void {
    npc.state.target = '';
    const post = npc.placement.spawn;
    if (Math.hypot(post.x - npc.state.x, post.y - npc.state.y) <= POST_RADIUS) {
      ctx.stop(npc);
      npc.state.mode = 'idle';
      return;
    }
    npc.state.mode = 'return';
    if (ctx.walk(npc, post, def.speedPxPerSecond) !== 'walking') {
      // Arrived, or no way back (should not happen on a valid map): wait where it stands.
      ctx.stop(npc);
      npc.state.mode = 'idle';
    }
  }

  return {
    behaviour: 'butcher',
    spawn(_ctx: NpcContext, npc: Npc): void {
      memory.set(npc.id, { nextSwingAt: 0 });
      npc.state.mode = 'idle';
      npc.state.target = '';
    },
    tick(ctx: NpcContext, npc: Npc): void {
      const def = defOf(npc);
      const m = mem(npc);
      if (!atHome(ctx, def, npc.state)) {
        goHome(ctx, npc, def);
        return;
      }
      const inside = intruders(ctx, def);
      if (inside.length === 0) {
        goHome(ctx, npc, def);
        return;
      }
      const target =
        inside.find((p) => p.sessionId === npc.state.target) ??
        inside.reduce((best, p) =>
          Math.hypot(p.x - npc.state.x, p.y - npc.state.y) <
          Math.hypot(best.x - npc.state.x, best.y - npc.state.y)
            ? p
            : best,
        );
      npc.state.mode = 'attack';
      npc.state.target = target.sessionId;
      const at: Vec2 = { x: target.x, y: target.y };
      const melee = def.attack.melee;
      const reach = melee.rangePx + ctx.config.playerHitboxSize / 2;
      if (Math.hypot(at.x - npc.state.x, at.y - npc.state.y) <= reach) {
        ctx.stop(npc);
        ctx.face(npc, at);
        if (ctx.now >= m.nextSwingAt) {
          m.nextSwingAt = ctx.now + def.attack.cooldownSeconds;
          ctx.swing(npc, { melee, aim: npc.state.aim, only: inside.map((p) => p.sessionId) });
        }
        return;
      }
      if (ctx.walk(npc, at, def.speedPxPerSecond) === 'unreachable') ctx.stop(npc);
    },
    onKo(_ctx: NpcContext, npc: Npc): void {
      memory.delete(npc.id);
    },
    reset(): void {
      memory.clear();
    },
  };
}
