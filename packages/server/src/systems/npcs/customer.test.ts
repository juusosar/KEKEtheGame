// Customers (Phase 2 decision 8, P2-3): groups that browse together, solid bodies players cannot walk
// into, panic on violence within 5 tiles for 4 s, Wanted on damage, and they never attack. The first
// map has no customer spawns, so these tests add one group spawn near van 0.
import { Button, aabbOverlapsSolid, getNpcCatalogue, type NpcSpawn, type Vec2 } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { config, must, spot } from '../combat/testKit';
import { createCustomerBehaviour } from './customer';
import { createSecurityBehaviour } from './security';
import { npcIdle, npcPress, npcSetup, npcTick, putNpc, type NpcSetup } from './testKit';

const def = getNpcCatalogue().require('customer');
if (def.behaviour !== 'customer') throw new Error('customer is not a customer');
const customer = def;
const TILE = config.tileSize;

/** A group spawn on the loading dock floor 6 tiles right of van 0's spawn (players stand at spot(...)). */
const SPAWN: NpcSpawn = { type: 'customer', ...spot(6 * TILE, 0), post: false };

function setup(players = 1, at?: (i: number) => Vec2, roundPlayers?: number): NpcSetup {
  return npcSetup(players, at, {
    modules: [createCustomerBehaviour()],
    spawns: [SPAWN],
    ...(roundPlayers === undefined ? {} : { roundPlayers }),
  });
}

function customers(s: NpcSetup): { id: string; x: number; y: number; mode: string; moving: boolean }[] {
  return [...s.state.npcs.values()].filter((n) => n.behaviour === 'customer');
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('customer', () => {
  it('spawns 6 + players customers in groups of 2 to 4 at the group spawn', () => {
    const s = setup(1, undefined, 1);
    const all = customers(s);
    expect(all).toHaveLength(7);
    const groups = all.map((c) => must(s.npcs.npc(c.id)).placement.group);
    expect(groups).toEqual([1, 1, 1, 1, 2, 2, 2]);
    for (const c of all) {
      expect(dist(c, SPAWN), c.id).toBeLessThanOrEqual(2 * TILE);
      expect(must(s.state.npcs.get(c.id)).hp).toBe(customer.hp);
    }
    expect(setup(1, undefined, 8).state.npcs.size).toBe(14);
  });

  it('walks slowly with its group to a waypoint, browses there, then moves on together', () => {
    const s = setup();
    // Arrive at the first (nearest) waypoint and browse.
    let browsing = false;
    npcIdle(s, 20, () => (browsing ||= customers(s).every((c) => c.mode === 'browse')));
    expect(browsing).toBe(true);
    // Never faster than the browse speed (one tick of slack for the start).
    const before = new Map(customers(s).map((c) => [c.id, { x: c.x, y: c.y }]));
    npcTick(s);
    for (const c of customers(s)) {
      expect(dist(c, must(before.get(c.id)))).toBeLessThanOrEqual(
        customer.speedPxPerSecond / config.serverTickHz + 1e-3,
      );
    }
    // Over a long stretch (the first map's waypoints are far apart at 60 px/s) each group visits more
    // than one waypoint, and its members stay together.
    const waypoints = new Map<number, Set<number>>();
    npcIdle(s, 150, () => {
      for (const c of customers(s)) {
        if (c.mode !== 'browse') continue;
        const near = s.live.npcWaypoints.findIndex((w) => dist(w, c) <= 1.5 * TILE);
        const g = must(s.npcs.npc(c.id)).placement.group ?? 0;
        if (near >= 0) waypoints.set(g, (waypoints.get(g) ?? new Set()).add(near));
      }
    });
    for (const g of [1, 2]) expect(waypoints.get(g)?.size ?? 0, `group ${g}`).toBeGreaterThan(1);
    for (const g of [1, 2]) {
      const members = customers(s).filter((c) => must(s.npcs.npc(c.id)).placement.group === g);
      if (members.every((m) => m.mode === 'browse')) {
        for (const m of members) expect(dist(m, must(members[0]))).toBeLessThanOrEqual(3 * TILE);
      }
    }
  });

  it('panics within 5 tiles of violence: runs straight away at 150 px/s for 4 s, then shops again', () => {
    const s = setup();
    npcIdle(s, 1);
    const c = must(customers(s)[0]);
    const id = c.id;
    const npc = must(s.state.npcs.get(id));
    const from = { x: npc.x, y: npc.y };
    // Violence 3 tiles to the left (in reach): it runs right.
    s.npcs.violence({ x: from.x - 3 * TILE, y: from.y });
    expect(npc.mode).toBe('panic');
    npcTick(s);
    const step = npc.x - from.x;
    expect(step).toBeGreaterThan(0);
    expect(step).toBeCloseTo(customer.panic.speedPxPerSecond / config.serverTickHz, 0);
    expect(Math.abs(npc.y - from.y)).toBeLessThan(1);
    npcIdle(s, customer.panic.seconds - 0.2);
    expect(npc.mode).toBe('panic');
    npcIdle(s, 0.4);
    expect(['walk', 'browse']).toContain(npc.mode);
  });

  it('ignores violence farther than 5 tiles away', () => {
    const s = setup();
    npcIdle(s, 1);
    const radius = customer.panic.radiusTiles * TILE;
    const all = customers(s);
    const c = must(all[0]);
    // The whole group stands within 2 tiles of `c`: 3 tiles past the radius is out of reach for all.
    const far = { x: c.x, y: c.y - radius - 3 * TILE };
    s.npcs.violence(far);
    expect(customers(s).every((n) => n.mode !== 'panic')).toBe(true);
    // Just inside the radius of `c`: it panics.
    s.npcs.violence({ x: c.x, y: c.y - radius + 2 });
    expect(must(s.state.npcs.get(c.id)).mode).toBe('panic');
  });

  it('a punched customer takes damage, makes the attacker Wanted and runs from them; its group scatters', () => {
    const s = setup(1, () => spot(6 * TILE, 3 * TILE));
    const p = must(s.players[0]);
    const hpBefore = p.hp;
    const all = customers(s);
    const first = must(all[0]);
    // Hold the target still next to the player (right above), the rest stay where they spawned.
    putNpc(s, first.id, { x: p.x, y: p.y - 26 });
    npcPress(s, p, Button.Attack, -Math.PI / 2);
    npcIdle(s, 0.5);
    const hit = must(s.state.npcs.get(first.id));
    expect(hit.hp).toBeLessThan(customer.hp ?? 0);
    expect(s.npcHits).toEqual([
      expect.objectContaining({ attacker: p.sessionId, victim: { kind: 'npc', id: first.id } }),
    ]);
    expect(hit.mode).toBe('panic');
    expect(hit.y).toBeLessThan(p.y - 26);
    const scattered = customers(s).filter((n) => n.mode === 'panic');
    expect(scattered.length).toBeGreaterThan(1);
    // Customers never fight back.
    npcIdle(s, 5);
    expect(s.npcEvents.some((e) => e.type === 'npcAttack')).toBe(false);
    expect(p.hp).toBe(hpBefore);
  });

  it('steps back out of a player it walks into, and reports solid bodies only while up', () => {
    const s = setup();
    const p = must(s.players[0]);
    const c = must(customers(s)[0]);
    putNpc(s, c.id, { x: p.x + 4, y: p.y });
    npcTick(s);
    const n = must(s.state.npcs.get(c.id));
    const r = customer.hitboxPx / 2 + config.playerHitboxSize / 2;
    expect(dist(n, p)).toBeGreaterThanOrEqual(r - 1e-6);
    expect(
      aabbOverlapsSolid(s.live.collision, n, { hw: customer.hitboxPx / 2, hh: customer.hitboxPx / 2 }),
    ).toBe(false);
    const bodies = s.npcs.solidBodies();
    expect(bodies).toHaveLength(customers(s).length);
    expect(bodies.every((b) => b.r === customer.hitboxPx / 2)).toBe(true);
    // Players are not solid bodies, and the other workers are not either.
    expect(npcSetup(1).npcs.solidBodies()).toEqual([]);
  });

  it('a KO takes the body out of the solids until the 30 s respawn at the group spawn', () => {
    const s = setup();
    const c = must(customers(s)[0]);
    const before = s.npcs.solidBodies().length;
    s.npcs.hit({ source: { kind: 'player', id: 'p0' }, target: c.id, damage: 999, delivery: 'melee' });
    expect(must(s.state.npcs.get(c.id)).alive).toBe(false);
    expect(s.npcs.solidBodies()).toHaveLength(before - 1);
    npcIdle(s, config.npcRespawnSeconds + 0.2);
    const back = must(s.state.npcs.get(c.id));
    expect(back.alive).toBe(true);
    expect(dist(back, SPAWN)).toBeLessThanOrEqual(10 * TILE);
    expect(s.npcs.solidBodies()).toHaveLength(before);
  });

  it('blocks a guard’s sight of a Wanted player', () => {
    const s = npcSetup(1, () => spot(0, 0), {
      modules: [createSecurityBehaviour(), createCustomerBehaviour()],
      spawns: [SPAWN],
    });
    const p = must(s.players[0]);
    const guardId = must(
      [...s.state.npcs.values()].find((n) => n.behaviour === 'security' && !s.npcs.npc(n.id)?.placement.post),
    ).id;
    const shopper = must(customers(s)[0]).id;
    putNpc(s, guardId, { x: p.x + 120, y: p.y });
    putNpc(s, shopper, { x: p.x + 60, y: p.y });
    s.npcs.holdForTest(shopper, 5);
    // The other customers stay out of the way.
    for (const c of customers(s)) if (c.id !== shopper) putNpc(s, c.id, SPAWN);
    s.wanted.push(p.sessionId);
    npcTick(s);
    const guard = must(s.state.npcs.get(guardId));
    expect(guard.target).toBe('');
    putNpc(s, shopper, { x: p.x + 60, y: p.y + 40 });
    npcTick(s);
    expect(guard.mode).toBe('chase');
    expect(guard.target).toBe(p.sessionId);
  });
});
