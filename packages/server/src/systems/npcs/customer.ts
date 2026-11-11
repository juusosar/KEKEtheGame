// Customer (§9.2; Phase 2 decision 8, P2-3). Shoppers on the second store map: they come in groups of 2 to 4
// (`placement.group`, planNpcs), and each group walks slowly (`speedPxPerSecond`, 60) between random aisle
// waypoints and browses at each for `browse.pauseSeconds`. Members stand a little apart around the
// group's waypoint. They never attack.
//
// Their bodies are solid (npcs.json `solid`): players are pushed out of them (shared `pushOutOfSolids`
// in movement), they block guard sight, and a customer that walks into a player steps back out of them.
//
// Panic: violence within `panic.radiusTiles` (NpcSystem.violence: any landed hit on a player or an NPC,
// which covers splashes, KOs and forklift run-overs) makes a customer run straight away from the spot at
// `panic.speedPxPerSecond` for `panic.seconds`, sliding along walls; every new violence in reach restarts
// it with a new direction. A customer that is hit itself runs away from its attacker. Afterwards it walks
// back to its group. Hitting one is NPC damage like any worker (Wanted); KO and the 30 s respawn are the
// NpcSystem's. Synced `mode`: 'walk' (to the group's waypoint), 'browse' (standing at it), 'panic'.
import { circleSeparation, findSpawn, type NpcOf, type Vec2 } from '@keke/shared';
import type { Npc, NpcBehaviourModule, NpcContext, NpcHitInfo } from './types';

/** Where members stand around the group's waypoint, by member index (pixels). */
const MEMBER_OFFSETS: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 0, y: 24 },
  { x: -24, y: 0 },
  { x: 0, y: -24 },
];

interface Group {
  /** Index into map.npcWaypoints the group heads to or browses at; -1 = none yet. */
  waypoint: number;
  /** Browsing until this round time; null while the group walks. Set when its first member arrives. */
  browseUntil: number | null;
  /** Member ids in spawn order (a member's offset is its index here). */
  readonly members: string[];
}

interface Memory {
  /** The waypoint this customer stands at (arrived), or -1 while walking or after a panic. */
  at: number;
  /** Panicking until this round time (0 = calm), running along `panicDir` (unit vector). */
  panicUntil: number;
  panicDir: Vec2;
}

function defOf(npc: Npc): NpcOf<'customer'> {
  if (npc.def.behaviour !== 'customer') throw new Error(`customer module got a ${npc.def.behaviour}`);
  return npc.def;
}

function unit(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-6 ? { x: v.x / len, y: v.y / len } : null;
}

export function createCustomerBehaviour(): NpcBehaviourModule {
  const memory = new Map<string, Memory>();
  const groups = new Map<number, Group>();

  function mem(npc: Npc): Memory {
    let m = memory.get(npc.id);
    if (!m) {
      m = { at: -1, panicUntil: 0, panicDir: { x: 1, y: 0 } };
      memory.set(npc.id, m);
    }
    return m;
  }

  function groupOf(npc: Npc): Group {
    // Without a group (hand-made placements in tests) a customer is its own group, keyed below 0.
    const key = npc.placement.group ?? -Number(npc.id.replace(/\D/g, '') || 0) - 1;
    let g = groups.get(key);
    if (!g) {
      g = { waypoint: -1, browseUntil: null, members: [] };
      groups.set(key, g);
    }
    if (!g.members.includes(npc.id)) g.members.push(npc.id);
    return g;
  }

  /** The waypoint nearest to `at`, or -1 when the map has none. */
  function nearestWaypoint(ctx: NpcContext, at: Vec2): number {
    let best = -1;
    let bestD = Infinity;
    ctx.map.npcWaypoints.forEach((wp, i) => {
      const d = Math.hypot(wp.x - at.x, wp.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** A random waypoint other than `current` (the only one when the map has just one). */
  function nextWaypoint(ctx: NpcContext, current: number): number {
    const n = ctx.map.npcWaypoints.length;
    if (n === 0) return -1;
    if (n === 1) return 0;
    const pick = ctx.rng.int(0, n - 2);
    return pick >= current && current >= 0 ? pick + 1 : pick;
  }

  /** Where this member stands at the group's waypoint: its offset, nudged off walls. */
  function standAt(ctx: NpcContext, npc: Npc, g: Group): Vec2 | null {
    const wp = ctx.map.npcWaypoints[g.waypoint];
    if (!wp) return null;
    const offset = MEMBER_OFFSETS[g.members.indexOf(npc.id) % MEMBER_OFFSETS.length] ?? { x: 0, y: 0 };
    return findSpawn(ctx.map.collision, { x: wp.x + offset.x, y: wp.y + offset.y }, npc.half);
  }

  /** Steps back out of any player the customer overlaps (it yields; players are pushed by movement). */
  function yieldToPlayers(ctx: NpcContext, npc: Npc): void {
    const r = npc.def.hitboxPx / 2;
    const pr = ctx.config.playerHitboxSize / 2;
    const aim = npc.state.aim;
    const moving = npc.state.moving;
    for (const p of ctx.players()) {
      const sep = circleSeparation({ x: npc.state.x, y: npc.state.y, r }, { x: p.x, y: p.y, r: pr });
      if (sep) ctx.moveBy(npc, sep);
    }
    npc.state.aim = aim;
    npc.state.moving = moving;
  }

  function startPanic(ctx: NpcContext, npc: Npc, dir: Vec2): void {
    const m = mem(npc);
    m.panicUntil = ctx.now + defOf(npc).panic.seconds;
    m.panicDir = dir;
    m.at = -1;
    ctx.stop(npc);
    npc.state.mode = 'panic';
  }

  function randomDir(ctx: NpcContext): Vec2 {
    const a = ctx.rng.next() * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  function shop(ctx: NpcContext, npc: Npc, m: Memory, def: NpcOf<'customer'>): void {
    const g = groupOf(npc);
    if (g.browseUntil !== null && ctx.now >= g.browseUntil) {
      g.browseUntil = null;
      g.waypoint = nextWaypoint(ctx, g.waypoint);
    }
    if (g.waypoint < 0) g.waypoint = nearestWaypoint(ctx, { x: npc.state.x, y: npc.state.y });
    if (m.at === g.waypoint && g.browseUntil !== null) {
      npc.state.mode = 'browse';
      return;
    }
    const goal = standAt(ctx, npc, g);
    if (!goal) {
      npc.state.mode = 'idle';
      return;
    }
    npc.state.mode = 'walk';
    const result = ctx.walk(npc, goal, def.speedPxPerSecond);
    if (result === 'walking') return;
    // Arrived, or cannot get there (blocked off): browse where it stands with the group.
    m.at = g.waypoint;
    if (g.browseUntil === null) {
      const { min, max } = def.browse.pauseSeconds;
      g.browseUntil = ctx.now + min + ctx.rng.next() * Math.max(0, max - min);
    }
    npc.state.mode = 'browse';
  }

  return {
    behaviour: 'customer',
    spawn(ctx: NpcContext, npc: Npc): void {
      memory.delete(npc.id);
      mem(npc);
      groupOf(npc);
      npc.state.mode = 'walk';
      npc.state.target = '';
      // Facing a random shelf so a group does not all look the same way.
      npc.state.aim = ctx.rng.next() * Math.PI * 2;
    },
    tick(ctx: NpcContext, npc: Npc, dt: number): void {
      const def = defOf(npc);
      const m = mem(npc);
      if (ctx.now < m.panicUntil) {
        npc.state.mode = 'panic';
        const speed = def.panic.speedPxPerSecond * dt;
        ctx.moveBy(npc, { x: m.panicDir.x * speed, y: m.panicDir.y * speed });
      } else {
        if (m.panicUntil > 0) m.panicUntil = 0;
        shop(ctx, npc, m, def);
      }
      yieldToPlayers(ctx, npc);
    },
    onViolence(ctx: NpcContext, npc: Npc, at: Vec2): void {
      const def = defOf(npc);
      const away = { x: npc.state.x - at.x, y: npc.state.y - at.y };
      if (Math.hypot(away.x, away.y) > def.panic.radiusTiles * ctx.config.tileSize) return;
      const m = mem(npc);
      // Hit itself (violence on its own spot): keep running the way it was, or pick a way at random;
      // onHit then turns it away from the attacker.
      const dir = unit(away) ?? (ctx.now < m.panicUntil ? m.panicDir : randomDir(ctx));
      startPanic(ctx, npc, dir);
    },
    onHit(ctx: NpcContext, npc: Npc, hit: NpcHitInfo): void {
      if (hit.ko || hit.source.kind !== 'player') return;
      const attacker = ctx.player(hit.source.id);
      if (!attacker) return;
      const dir = unit({ x: npc.state.x - attacker.x, y: npc.state.y - attacker.y });
      if (dir) startPanic(ctx, npc, dir);
    },
    onKo(_ctx: NpcContext, npc: Npc): void {
      memory.delete(npc.id);
    },
    reset(): void {
      memory.clear();
      groups.clear();
    },
  };
}
