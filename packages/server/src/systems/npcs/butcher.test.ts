// Butcher (M5-6): guards the behind_counter zone at the meat counter, ignores everyone else.
import { getNpcCatalogue, type CombatEventWire, type HitMessage, type Vec2 } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { must, spot } from '../combat/testKit';
import { createButcherBehaviour } from './butcher';
import { npcIdle, npcPress, npcSetup, npcTick, putNpc, type NpcSetup } from './testKit';

const def = getNpcCatalogue().require('butcher');
if (def.behaviour !== 'butcher') throw new Error('butcher is not a butcher');
const butcher = def;
const ID = 'butcher_1';

function hitsOn(events: CombatEventWire[], target: string): HitMessage[] {
  return events
    .filter((e) => e.type === 'hit')
    .map((e) => e.payload as HitMessage)
    .filter((h) => h.target === target && h.source.kind === 'npc');
}

function setup(at: (i: number) => Vec2, players = 1): NpcSetup {
  return npcSetup(players, at, { modules: [createButcherBehaviour()] });
}

function home(s: NpcSetup): Vec2 {
  const n = must(s.npcs.npc(ID));
  return n.placement.spawn;
}

/** A point in the guard zone `dx` px right of the butcher's post. */
function behind(s: NpcSetup, dx: number): Vec2 {
  const p = home(s);
  return { x: p.x + dx, y: p.y };
}

describe('butcher', () => {
  it('spawns one butcher inside the guard zone, idle', () => {
    const s = setup((i) => spot(i * 30));
    const n = must(s.state.npcs.get(ID));
    expect(s.npcs.behaviours).toEqual(['butcher']);
    expect(n).toMatchObject({ type: 'butcher', behaviour: 'butcher', hp: butcher.hp, alive: true });
    expect(s.live.zoneAt(n.x, n.y)?.id).toBe(butcher.guardZone);
    npcIdle(s, 2);
    expect(n.mode).toBe('idle');
    expect(n.target).toBe('');
    expect(n.moving).toBe(false);
  });

  it('guards the rectangle the e2e helpers copy (tests/e2e/helpers.ts BEHIND_COUNTER)', () => {
    const s = setup((i) => spot(i * 30));
    const zone = must(s.live.zones.find((z) => z.id === butcher.guardZone));
    expect(zone.bounds).toEqual({ minX: 1600, minY: 1312, maxX: 1600 + 352, maxY: 1312 + 160 });
  });

  it('ignores players outside the counter, even when they hit it', () => {
    const s = setup((i) => spot(i * 30));
    const p = must(s.players[0]);
    const n = must(s.state.npcs.get(ID));
    // Right in front of the counter, but in meat_fish rather than behind_counter.
    const front = { x: n.x, y: 1312 + 160 + 24 };
    expect(s.live.zoneAt(front.x, front.y)?.id).toBe(butcher.homeZone);
    p.x = front.x;
    p.y = front.y;
    putNpc(s, ID, { x: front.x, y: front.y - 30 });
    npcPress(s, p, 1 << 0, -Math.PI / 2); // punch it
    npcIdle(s, 3);
    expect(hitsOn(s.events, p.sessionId)).toEqual([]);
    expect(n.target).toBe('');
  });

  it('cleaves a player behind the counter for 20 on its cooldown', () => {
    let s = setup(() => ({ x: 0, y: 0 }));
    const at = behind(s, 20);
    s = setup(() => at);
    const p = must(s.players[0]);
    npcIdle(s, 2.05);
    const hits = hitsOn(s.events, p.sessionId);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0]).toMatchObject({ source: { kind: 'npc', id: ID }, damage: butcher.attack.melee.damage });
    expect(must(s.state.npcs.get(ID)).target).toBe(p.sessionId);
    expect(must(s.state.npcs.get(ID)).mode).toBe('attack');
  });

  it('chases an intruder along the counter, then walks back to its post when they leave', () => {
    let s = setup(() => ({ x: 0, y: 0 }));
    const far = behind(s, 150);
    expect(s.live.zoneAt(far.x, far.y)?.id).toBe(butcher.guardZone);
    s = setup(() => far);
    const p = must(s.players[0]);
    const n = must(s.state.npcs.get(ID));
    const post = { x: n.x, y: n.y };
    npcIdle(s, 3);
    expect(n.mode).toBe('attack');
    expect(Math.hypot(n.x - p.x, n.y - p.y)).toBeLessThan(butcher.attack.melee.rangePx + 10);
    expect(hitsOn(s.events, p.sessionId).length).toBeGreaterThan(0);
    // The player steps out: the butcher goes home.
    const away = spot();
    p.x = away.x;
    p.y = away.y;
    npcTick(s);
    expect(n.mode).toBe('return');
    expect(n.target).toBe('');
    npcIdle(s, 4);
    expect(n.mode).toBe('idle');
    expect(Math.hypot(n.x - post.x, n.y - post.y)).toBeLessThanOrEqual(4);
  });

  it('only hits players behind the counter, never a bystander in its arc', () => {
    let s = setup(() => ({ x: 0, y: 0 }));
    const post = home(s);
    // p0 behind the counter next to it; p1 straight across the zone edge below (in meat_fish).
    const inside = { x: post.x, y: 1312 + 160 - 12 };
    const outside = { x: post.x, y: 1312 + 160 + 12 };
    s = setup((i) => (i === 0 ? inside : outside), 2);
    const [a, b] = [must(s.players[0]), must(s.players[1])];
    expect(s.live.zoneAt(b.x, b.y)?.id).toBe(butcher.homeZone);
    putNpc(s, ID, { x: post.x, y: inside.y - 20 });
    npcIdle(s, 1.5);
    expect(hitsOn(s.events, a.sessionId).length).toBeGreaterThan(0);
    expect(hitsOn(s.events, b.sessionId)).toEqual([]);
  });

  it('walks back home when it ends up outside the meat counter (shoved out)', () => {
    const s = setup((i) => spot(i * 30));
    const n = must(s.state.npcs.get(ID));
    const post = { x: n.x, y: n.y };
    // The nearest open floor tile outside the meat & fish area (a body-sized box fits on it).
    const g = s.live.collision;
    let out: Vec2 | undefined;
    let best = Infinity;
    for (let ty = 1; ty < g.height - 1; ty++) {
      for (let tx = 1; tx < g.width - 1; tx++) {
        const c = { x: (tx + 0.5) * 32, y: (ty + 0.5) * 32 };
        const zone = s.live.zoneAt(c.x, c.y)?.id;
        if (zone === butcher.homeZone || zone === butcher.guardZone) continue;
        if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => g.isSolid(tx + dx, ty + dy)))) continue;
        const d = Math.hypot(c.x - post.x, c.y - post.y);
        if (d < best) {
          best = d;
          out = c;
        }
      }
    }
    putNpc(s, ID, must(out));
    expect(s.live.zoneAt(n.x, n.y)?.id).not.toBe(butcher.homeZone);
    npcTick(s);
    expect(n.mode).toBe('return');
    npcIdle(s, 12);
    expect(n.mode).toBe('idle');
    expect(Math.hypot(n.x - post.x, n.y - post.y)).toBeLessThanOrEqual(4);
  });
});
