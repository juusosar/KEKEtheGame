// Forklift (M5-5): one per route, drives its loop with corner stops, is invulnerable, runs over players it
// touches while driving (damage, knockdown, thrown out of the lane, item drop) with a per-player cooldown.
import {
  aabbOverlapsSolid,
  Button,
  getNpcCatalogue,
  type CombatEventWire,
  type DropReason,
  type HitMessage,
  type Vec2,
} from '@keke/shared';
import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../../schema/GameState';
import { config, must } from '../combat/testKit';
import { createForkliftBehaviour, forkliftThrowDir } from './forklift';
import { npcIdle, npcPress, npcSetup, npcTick, putNpc, type NpcSetup } from './testKit';

const forklift = getNpcCatalogue().require('forklift');
if (forklift.behaviour !== 'forklift') throw new Error('forklift is not a forklift');
const contact = forklift.contact;

function setupForklifts(players = 1): NpcSetup & { drops: { player: string; reason: DropReason }[] } {
  const drops: { player: string; reason: DropReason }[] = [];
  const s = npcSetup(players, undefined, {
    modules: [createForkliftBehaviour()],
    hooks: { dropCarried: (p, reason) => drops.push({ player: p.sessionId, reason }) },
  });
  return { ...s, drops };
}

function hitsOn(events: CombatEventWire[], target: string): HitMessage[] {
  return events
    .filter((e) => e.type === 'hit')
    .map((e) => e.payload as HitMessage)
    .filter((h) => h.target === target);
}

/** Distance from p to the closed polyline. */
function distToLoop(points: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = must(points[i]);
    const b = must(points[(i + 1) % points.length]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
  }
  return best;
}

/** Puts `p` `ahead` pixels in front of forklift_1, on its lane, and returns the forklift state. */
function inFrontOf(s: NpcSetup, p: PlayerState, ahead: number) {
  const npc = must(s.state.npcs.get('forklift_1'));
  const route = must(s.live.forkliftRoutes[0]).points;
  const next = must(route[1]);
  const d = Math.hypot(next.x - npc.x, next.y - npc.y);
  p.x = npc.x + ((next.x - npc.x) / d) * ahead;
  p.y = npc.y + ((next.y - npc.y) / d) * ahead;
  return npc;
}

describe('forklift', () => {
  it('spawns one invulnerable forklift per route, at the start of its route', () => {
    const s = setupForklifts(2);
    const routes = s.live.forkliftRoutes;
    expect(routes.length).toBeGreaterThan(0);
    const ids = [...s.state.npcs.keys()].sort();
    expect(ids).toEqual(routes.map((_, i) => `forklift_${i + 1}`));
    routes.forEach((route, i) => {
      const n = must(s.state.npcs.get(`forklift_${i + 1}`));
      const start = must(route.points[0]);
      expect(Math.hypot(n.x - start.x, n.y - start.y)).toBeLessThan(1);
      expect(n.behaviour).toBe('forklift');
      expect(n.maxHp).toBe(0);
      expect(n.mode).toBe('drive');
    });
  });

  it('drives its whole loop in order, on the lane, stopping at every corner', () => {
    const s = setupForklifts(1);
    const route = must(s.live.forkliftRoutes[0]).points;
    const half = { hw: forklift.hitboxPx / 2, hh: forklift.hitboxPx / 2 };
    let perimeter = 0;
    for (let i = 0; i < route.length; i++) {
      const a = must(route[i]);
      const b = must(route[(i + 1) % route.length]);
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const lap = perimeter / forklift.speedPxPerSecond + route.length * forklift.cornerStopSeconds;
    // Players out of the way (van 0); the corner reached each time the forklift enters 'corner'.
    const corners: number[] = [];
    const stopTicks: number[] = [];
    let mode = 'drive';
    npcIdle(s, lap + 1, () => {
      const n = must(s.state.npcs.get('forklift_1'));
      expect(distToLoop(route, n)).toBeLessThan(1);
      expect(aabbOverlapsSolid(s.live.collision, n, half)).toBe(false);
      if (n.mode === 'corner') {
        if (mode !== 'corner') {
          const at = route.findIndex((p) => Math.hypot(p.x - n.x, p.y - n.y) < 1);
          corners.push(at);
          stopTicks.push(0);
        }
        stopTicks[stopTicks.length - 1] = must(stopTicks.at(-1)) + 1;
        // It drove onto the corner in the tick it entered 'corner'; still after that.
        if (mode === 'corner') expect(n.moving).toBe(false);
      } else {
        expect(n.mode).toBe('drive');
        expect(n.moving).toBe(true);
      }
      mode = n.mode;
    });
    const expected = route.map((_, i) => (i + 1) % route.length);
    expect(corners.slice(0, route.length)).toEqual(expected);
    // Each full stop lasts cornerStopSeconds (within a tick).
    for (const ticks of stopTicks.slice(0, route.length - 1)) {
      expect(Math.abs(ticks / config.serverTickHz - forklift.cornerStopSeconds)).toBeLessThanOrEqual(
        1 / config.serverTickHz + 1e-9,
      );
    }
  });

  it('runs over a player in its lane: damage, knockdown, thrown out of the lane, item dropped', () => {
    const s = setupForklifts(1);
    const p = must(s.players[0]);
    const npc = inFrontOf(s, p, 26);
    const route = must(s.live.forkliftRoutes[0]).points;
    for (let i = 0; i < 10 && hitsOn(s.events, p.sessionId).length === 0; i++) npcTick(s);
    const hits = hitsOn(s.events, p.sessionId);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: { kind: 'hazard', id: 'forklift_1' },
      damage: contact.damage,
    });
    expect(p.hp).toBe(100 - contact.damage);
    expect(p.stunned).toBe(true);
    expect(s.drops).toEqual([{ player: p.sessionId, reason: 'forklift' }]);
    // The shove carries them clear of the lane.
    npcIdle(s, 0.5);
    expect(distToLoop(route, p)).toBeGreaterThan(forklift.hitboxPx / 2 + config.playerHitboxSize / 2 - 1);
    expect(npc.mode).toBe('drive');
  });

  it('hits the same player again only after the cooldown', () => {
    const s = setupForklifts(1);
    const p = must(s.players[0]);
    inFrontOf(s, p, 20);
    npcTick(s);
    expect(hitsOn(s.events, p.sessionId)).toHaveLength(1);
    // Keep standing in its way: no second hit inside the cooldown...
    const ticks = Math.floor(contact.hitCooldownSeconds * config.serverTickHz) - 2;
    for (let i = 0; i < ticks; i++) {
      inFrontOf(s, p, 10);
      npcTick(s);
    }
    expect(hitsOn(s.events, p.sessionId)).toHaveLength(1);
    // ...and another once it has passed.
    for (let i = 0; i < 4; i++) {
      inFrontOf(s, p, 10);
      npcTick(s);
    }
    expect(hitsOn(s.events, p.sessionId)).toHaveLength(2);
  });

  it('does not hit anyone while stopped at a corner', () => {
    const s = setupForklifts(1);
    const p = must(s.players[0]);
    const n = must(s.state.npcs.get('forklift_1'));
    // Drive until it stops at a corner, then step into it.
    for (let i = 0; i < 2000 && n.mode !== 'corner'; i++) npcTick(s);
    expect(n.mode).toBe('corner');
    s.events.length = 0;
    p.x = n.x;
    p.y = n.y;
    const stopTicks = Math.floor(forklift.cornerStopSeconds * config.serverTickHz) - 2;
    for (let i = 0; i < stopTicks; i++) npcTick(s);
    expect(hitsOn(s.events, p.sessionId)).toHaveLength(0);
  });

  it('is invulnerable: punches pass through it', () => {
    const s = setupForklifts(1);
    const a = must(s.players[0]);
    putNpc(s, 'forklift_1', { x: a.x + 24, y: a.y });
    npcPress(s, a, Button.Attack, 0);
    expect(s.npcEvents.filter((e) => e.type === 'npcHit')).toHaveLength(0);
    expect(must(s.state.npcs.get('forklift_1')).alive).toBe(true);
  });

  it('throws players sideways out of the lane, on the side they stand', () => {
    const left = forkliftThrowDir({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 5, y: -3 });
    expect(left.y).toBeLessThan(-0.8);
    expect(left.x).toBeGreaterThan(0);
    const right = forkliftThrowDir({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 3 });
    expect(right.y).toBeGreaterThan(0.8);
    expect(Math.hypot(right.x, right.y)).toBeCloseTo(1);
  });
});
