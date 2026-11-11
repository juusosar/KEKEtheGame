// Security guard (§8; M5-4). Guards keep order: they chase Wanted players and stun them with a baton
// swing (npcs.json `attack.melee`: 15 damage, 0.5 s stun) on a cooldown. A guard sees a Wanted player
// within `chase.sightRangeTiles` with a clear line (walls, parked carts and customers block). While it sees its target
// it runs after it at `chase.speedPxPerSecond`; out of sight it walks to where it last saw them and gives
// up after `chase.loseSightSeconds`. It sticks to its target while that player stays Wanted and in reach of
// its memory, but switches to a nearer visible Wanted player once the old one is out of sight.
//
// Two kinds of guard:
//  - Patrol guards walk between the shared aisle waypoints (`map.npcWaypoints`) and look around at each
//    stop for `patrol.pauseSeconds`.
//  - The posted guard (`placement.post`, the staff-only door on kespro) stands at its spawn. It only
//    chases players within its sight range of the post (a leash), so it never strays far from the door,
//    and walks back to the post afterwards. Players inside staff_only stay Wanted while inside, so the
//    door guard keeps after anyone who goes in.
//
// A guard with `releaseZones` (npcs.json, per map) does not see players standing in them: on prisma a
// Wanted player who makes it out of the store is let go, and the guard searches the door, then gives up.
//
// Being hit needs no special handling: the attacker becomes Wanted (npc_damage) through the wanted rules
// and the guard sees them on its next tick. Synced `mode`: 'patrol' (walking to a waypoint), 'watch'
// (pausing at a waypoint), 'post' (standing at its post), 'return' (walking back to the post), 'chase'
// (sees its `target`), 'search' (walking to where it last saw `target`).
import { bodiesBlockLine, clearLine, type NpcOf, type Vec2 } from '@keke/shared';
import type { PlayerState } from '../../schema/GameState';
import type { Npc, NpcBehaviourModule, NpcContext } from './types';

interface Memory {
  /** Index into map.npcWaypoints of the stop it walks to or stands at; -1 before the first. */
  waypoint: number;
  /** Looking around at a waypoint until this round time; null while walking. */
  watchUntil: number | null;
  /** The Wanted player it is after, where and when it last saw them. */
  target: string | null;
  lastSeen: Vec2;
  lastSeenAt: number;
  /** Round time its next swing is allowed. */
  nextSwingAt: number;
}

function defOf(npc: Npc): NpcOf<'security'> {
  if (npc.def.behaviour !== 'security') throw new Error(`security module got a ${npc.def.behaviour}`);
  return npc.def;
}

function fresh(): Memory {
  return {
    waypoint: -1,
    watchUntil: null,
    target: null,
    lastSeen: { x: 0, y: 0 },
    lastSeenAt: 0,
    nextSwingAt: 0,
  };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createSecurityBehaviour(): NpcBehaviourModule {
  const memory = new Map<string, Memory>();

  function mem(npc: Npc): Memory {
    let m = memory.get(npc.id);
    if (!m) {
      m = fresh();
      memory.set(npc.id, m);
    }
    return m;
  }

  function sightPx(ctx: NpcContext, def: NpcOf<'security'>): number {
    return def.chase.sightRangeTiles * ctx.config.tileSize;
  }

  /** Posted guards leash to their post: a player farther than the sight range from it is let go. */
  function inLeash(ctx: NpcContext, npc: Npc, def: NpcOf<'security'>, at: Vec2): boolean {
    return !npc.placement.post || dist(at, npc.placement.spawn) <= sightPx(ctx, def);
  }

  /** A player in one of the guard's `releaseZones` (outside the store on prisma) is let go (P4-2). */
  function released(ctx: NpcContext, def: NpcOf<'security'>, at: Vec2): boolean {
    const zones = def.releaseZones;
    if (!zones || zones.length === 0) return false;
    const zone = ctx.map.zoneAt(at.x, at.y)?.id;
    return zone !== undefined && zones.includes(zone);
  }

  function sees(ctx: NpcContext, npc: Npc, def: NpcOf<'security'>, p: PlayerState): boolean {
    const from = { x: npc.state.x, y: npc.state.y };
    const at = { x: p.x, y: p.y };
    return (
      dist(from, at) <= sightPx(ctx, def) &&
      inLeash(ctx, npc, def, at) &&
      !released(ctx, def, at) &&
      clearLine(ctx.map.collision, from, at) &&
      // Customers in the way block the view too (Phase 2 decision 8).
      !bodiesBlockLine(from, at, ctx.sightBlockers())
    );
  }

  /** The nearest Wanted player this guard can see right now (ties: wanted order). */
  function spot(
    ctx: NpcContext,
    npc: Npc,
    def: NpcOf<'security'>,
    wanted: readonly string[],
  ): PlayerState | undefined {
    let best: PlayerState | undefined;
    let bestD = Infinity;
    for (const id of wanted) {
      const p = ctx.player(id);
      if (!p || !sees(ctx, npc, def, p)) continue;
      const d = Math.hypot(p.x - npc.state.x, p.y - npc.state.y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  function drop(npc: Npc, m: Memory): void {
    m.target = null;
    npc.state.target = '';
  }

  /** Chases the remembered or a newly seen Wanted player. False when there is no one to chase. */
  function pursue(ctx: NpcContext, npc: Npc, m: Memory, def: NpcOf<'security'>): boolean {
    const wanted = ctx.wantedPlayers();
    let current = m.target !== null && wanted.includes(m.target) ? ctx.player(m.target) : undefined;
    if (m.target !== null && !current) drop(npc, m);
    const seesCurrent = current !== undefined && sees(ctx, npc, def, current);
    if (!seesCurrent) {
      // Out of sight (or no target yet): a visible Wanted player wins over a memory.
      const seen = spot(ctx, npc, def, wanted);
      if (seen) current = seen;
    }
    if (!current) {
      npc.state.target = '';
      return false;
    }
    const visible = seesCurrent || current.sessionId !== m.target;
    if (visible) {
      m.target = current.sessionId;
      m.lastSeen = { x: current.x, y: current.y };
      m.lastSeenAt = ctx.now;
    } else if (ctx.now - m.lastSeenAt > def.chase.loseSightSeconds) {
      drop(npc, m);
      return false;
    }
    m.watchUntil = null;
    npc.state.target = current.sessionId;

    if (!visible) {
      npc.state.mode = 'search';
      const r = ctx.walk(npc, m.lastSeen, def.chase.speedPxPerSecond);
      if (r !== 'walking') {
        // At the spot (or it cannot get there): look around until loseSightSeconds runs out.
        ctx.stop(npc);
      }
      return true;
    }

    npc.state.mode = 'chase';
    const at = { x: current.x, y: current.y };
    const reach = def.attack.melee.rangePx + ctx.config.playerHitboxSize / 2;
    if (dist(at, npc.state) <= reach) {
      ctx.stop(npc);
      ctx.face(npc, at);
      if (ctx.now >= m.nextSwingAt) {
        m.nextSwingAt = ctx.now + def.attack.cooldownSeconds;
        // The baton only lands on Wanted players: bystanders in the arc are spared.
        ctx.swing(npc, { melee: def.attack.melee, aim: npc.state.aim, only: wanted });
      }
      return true;
    }
    ctx.walk(npc, at, def.chase.speedPxPerSecond);
    return true;
  }

  function nextWaypoint(ctx: NpcContext, current: number): number {
    const n = ctx.map.npcWaypoints.length;
    if (n === 0) return -1;
    if (n === 1) return 0;
    const pick = ctx.rng.int(0, n - 2);
    return pick >= current && current >= 0 ? pick + 1 : pick;
  }

  function holdPost(ctx: NpcContext, npc: Npc, def: NpcOf<'security'>): void {
    const post = npc.placement.spawn;
    if (dist(post, npc.state) <= ctx.config.tileSize / 4) {
      ctx.stop(npc);
      npc.state.mode = 'post';
      return;
    }
    npc.state.mode = 'return';
    const r = ctx.walk(npc, post, def.speedPxPerSecond);
    if (r !== 'walking') {
      ctx.stop(npc);
      npc.state.mode = 'post';
    }
  }

  function patrol(ctx: NpcContext, npc: Npc, m: Memory, def: NpcOf<'security'>): void {
    if (m.watchUntil !== null) {
      npc.state.mode = 'watch';
      if (ctx.now < m.watchUntil) return;
      m.watchUntil = null;
      m.waypoint = nextWaypoint(ctx, m.waypoint);
    }
    if (m.waypoint < 0) m.waypoint = nextWaypoint(ctx, -1);
    const wp = ctx.map.npcWaypoints[m.waypoint];
    if (!wp) {
      npc.state.mode = 'idle';
      return;
    }
    npc.state.mode = 'patrol';
    const r = ctx.walk(npc, { x: wp.x, y: wp.y }, def.speedPxPerSecond);
    if (r === 'unreachable') {
      m.waypoint = nextWaypoint(ctx, m.waypoint);
      return;
    }
    if (r !== 'arrived') return;
    const { min, max } = def.patrol.pauseSeconds;
    m.watchUntil = ctx.now + min + ctx.rng.next() * Math.max(0, max - min);
    npc.state.mode = 'watch';
  }

  return {
    behaviour: 'security',
    spawn(_ctx: NpcContext, npc: Npc): void {
      memory.set(npc.id, fresh());
      npc.state.mode = npc.placement.post ? 'post' : 'patrol';
      npc.state.target = '';
    },
    tick(ctx: NpcContext, npc: Npc): void {
      const def = defOf(npc);
      const m = mem(npc);
      if (pursue(ctx, npc, m, def)) return;
      if (npc.placement.post) holdPost(ctx, npc, def);
      else patrol(ctx, npc, m, def);
    },
    onKo(_ctx: NpcContext, npc: Npc): void {
      memory.delete(npc.id);
    },
    removePlayer(id: string): void {
      for (const m of memory.values()) {
        if (m.target === id) m.target = null;
      }
    },
    reset(): void {
      memory.clear();
    },
  };
}
