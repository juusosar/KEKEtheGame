// Stocker (§8; M5-3): wanders between the aisle waypoints restocking shelves. At each stop it pauses
// (`wander.pauseSeconds`) and sometimes parks a stock cart beside it (`stockCart`), which blocks the aisle
// for `stockCart.seconds`. When a player hits it, it retaliates against that player for
// `retaliation.seconds` (every new hit restarts the time): it chases them at the retaliation speed and
// swings its melee (8 damage) on a cooldown, then goes back to work. Hits from other NPCs or hazards
// (a forklift) do not make it angry. Synced `mode`: 'walk', 'stock', 'angry'.
import type { NpcOf, Vec2 } from '@keke/shared';
import type { Npc, NpcBehaviourModule, NpcContext, NpcHitInfo } from './types';

interface Memory {
  /** Index into map.npcWaypoints of the stop it is walking to or standing at; -1 before the first. */
  waypoint: number;
  /** Restocking until this round time; null while walking. */
  stockUntil: number | null;
  /** Player it retaliates against, and until when. */
  angryAt: string | null;
  angryUntil: number;
  /** Round time its next swing is allowed. */
  nextSwingAt: number;
}

function defOf(npc: Npc): NpcOf<'stocker'> {
  if (npc.def.behaviour !== 'stocker') throw new Error(`stocker module got a ${npc.def.behaviour}`);
  return npc.def;
}

export function createStockerBehaviour(): NpcBehaviourModule {
  const memory = new Map<string, Memory>();

  function mem(npc: Npc): Memory {
    let m = memory.get(npc.id);
    if (!m) {
      m = { waypoint: -1, stockUntil: null, angryAt: null, angryUntil: 0, nextSwingAt: 0 };
      memory.set(npc.id, m);
    }
    return m;
  }

  /** A random waypoint other than the current one (the only one when the map has just one). */
  function nextWaypoint(ctx: NpcContext, current: number): number {
    const n = ctx.map.npcWaypoints.length;
    if (n === 0) return -1;
    if (n === 1) return 0;
    const pick = ctx.rng.int(0, n - 2);
    return pick >= current && current >= 0 ? pick + 1 : pick;
  }

  function calmDown(npc: Npc, m: Memory): void {
    m.angryAt = null;
    m.angryUntil = 0;
    npc.state.target = '';
    // Back to work: walk on to a stop (the old one is fine).
    m.stockUntil = null;
  }

  function retaliate(ctx: NpcContext, npc: Npc, m: Memory, def: NpcOf<'stocker'>): void {
    const target = m.angryAt === null ? undefined : ctx.player(m.angryAt);
    if (!target || ctx.now >= m.angryUntil) {
      calmDown(npc, m);
      return;
    }
    npc.state.mode = 'angry';
    npc.state.target = target.sessionId;
    const r = def.retaliation;
    const at: Vec2 = { x: target.x, y: target.y };
    const dist = Math.hypot(at.x - npc.state.x, at.y - npc.state.y);
    const reach = r.melee.rangePx + ctx.config.playerHitboxSize / 2;
    if (dist <= reach) {
      ctx.stop(npc);
      ctx.face(npc, at);
      if (ctx.now >= m.nextSwingAt) {
        m.nextSwingAt = ctx.now + r.cooldownSeconds;
        ctx.swing(npc, { melee: r.melee, aim: npc.state.aim, only: [target.sessionId] });
      }
      return;
    }
    ctx.walk(npc, at, r.speedPxPerSecond);
  }

  function work(ctx: NpcContext, npc: Npc, m: Memory, def: NpcOf<'stocker'>): void {
    if (m.stockUntil !== null) {
      npc.state.mode = 'stock';
      if (ctx.now < m.stockUntil) return;
      m.stockUntil = null;
      m.waypoint = nextWaypoint(ctx, m.waypoint);
    }
    if (m.waypoint < 0) m.waypoint = nextWaypoint(ctx, -1);
    const wp = ctx.map.npcWaypoints[m.waypoint];
    if (!wp) {
      npc.state.mode = 'idle';
      return;
    }
    npc.state.mode = 'walk';
    const result = ctx.walk(npc, { x: wp.x, y: wp.y }, def.speedPxPerSecond);
    if (result === 'unreachable') {
      // Blocked off (a cart, a wall): try another stop next tick.
      m.waypoint = nextWaypoint(ctx, m.waypoint);
      return;
    }
    if (result !== 'arrived') return;
    // At the shelf: restock for a while, maybe with a cart in the aisle.
    const { min, max } = def.wander.pauseSeconds;
    m.stockUntil = ctx.now + min + ctx.rng.next() * Math.max(0, max - min);
    npc.state.mode = 'stock';
    const cart = def.stockCart;
    if (cart.chancePerStop > 0 && ctx.rng.chance(Math.min(1, cart.chancePerStop))) {
      ctx.placeStockCart(npc, cart.lengthTiles, cart.seconds);
    }
  }

  return {
    behaviour: 'stocker',
    spawn(_ctx: NpcContext, npc: Npc): void {
      memory.set(npc.id, { waypoint: -1, stockUntil: null, angryAt: null, angryUntil: 0, nextSwingAt: 0 });
      npc.state.mode = 'walk';
    },
    tick(ctx: NpcContext, npc: Npc): void {
      const def = defOf(npc);
      const m = mem(npc);
      if (m.angryAt !== null) {
        retaliate(ctx, npc, m, def);
        if (m.angryAt !== null) return;
      }
      work(ctx, npc, m, def);
    },
    onHit(ctx: NpcContext, npc: Npc, hit: NpcHitInfo): void {
      if (hit.ko || hit.source.kind !== 'player') return;
      const m = mem(npc);
      const def = defOf(npc);
      if (m.angryAt !== hit.source.id) ctx.stop(npc);
      m.angryAt = hit.source.id;
      m.angryUntil = ctx.now + def.retaliation.seconds;
      m.stockUntil = null;
      npc.state.mode = 'angry';
      npc.state.target = hit.source.id;
    },
    onKo(_ctx: NpcContext, npc: Npc): void {
      memory.delete(npc.id);
    },
    removePlayer(id: string): void {
      for (const m of memory.values()) {
        if (m.angryAt === id) {
          m.angryAt = null;
          m.angryUntil = 0;
        }
      }
    },
    reset(): void {
      memory.clear();
    },
  };
}
