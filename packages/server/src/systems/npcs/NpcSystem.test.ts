// NPC framework + stocker (M5-3): spawning from the plan, hits from player weapons (fists, pallet jack),
// KO and the 30 s respawn, retaliation, wandering with event-driven repaths, and stock carts.
import {
  aabbOverlapsSolid,
  Button,
  getNpcCatalogue,
  npcCount,
  rectTiles,
  type CombatEventWire,
  type HitMessage,
  type NpcHitMessage,
} from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { config, give, must, spot, weapons } from '../combat/testKit';
import { npcIdle, npcPress, npcSetup, npcTick, putNpc, type NpcSetup } from './testKit';
import { createStockerBehaviour } from './stocker';
import type { NpcBehaviourModule } from './types';

const stocker = getNpcCatalogue().require('stocker');
if (stocker.behaviour !== 'stocker') throw new Error('stocker is not a stocker');
const fists = weapons.require('fists');
const fistDamage = 'melee' in fists ? fists.melee.damage : 0;

function hitsOn(events: CombatEventWire[], target: string): HitMessage[] {
  return events
    .filter((e) => e.type === 'hit')
    .map((e) => e.payload as HitMessage)
    .filter((h) => h.target === target);
}

describe('NpcSystem', () => {
  it('spawns the planned NPCs that have a behaviour module (here stockers only), at full HP', () => {
    const s = npcSetup(2, undefined, { modules: [createStockerBehaviour()] });
    const ids = [...s.state.npcs.keys()];
    expect(ids).toHaveLength(npcCount(stocker.count, 2));
    expect(ids.every((id) => id.startsWith('stocker_'))).toBe(true);
    for (const n of s.state.npcs.values()) {
      expect(n.type).toBe('stocker');
      expect(n.behaviour).toBe('stocker');
      expect(n.hp).toBe(stocker.hp);
      expect(n.maxHp).toBe(stocker.hp);
      expect(n.alive).toBe(true);
    }
    expect(s.npcs.behaviours).toEqual(['stocker']);
  });

  it('stockers wander between waypoints without entering walls, searching paths only on events', () => {
    const s = npcSetup(2, undefined, { modules: [createStockerBehaviour()] });
    const start = new Map([...s.state.npcs.values()].map((n) => [n.id, { x: n.x, y: n.y }]));
    const half = { hw: stocker.hitboxPx / 2, hh: stocker.hitboxPx / 2 };
    let ticks = 0;
    npcIdle(s, 20, () => {
      ticks++;
      for (const n of s.state.npcs.values()) expect(aabbOverlapsSolid(s.live.collision, n, half)).toBe(false);
    });
    for (const n of s.state.npcs.values()) {
      const from = must(start.get(n.id));
      expect(Math.hypot(n.x - from.x, n.y - from.y)).toBeGreaterThan(32);
      // A handful of stops in 20 s, not one search per tick.
      expect(s.npcs.searchesOf(n.id)).toBeLessThan(ticks / 5);
    }
  });

  it('a punch damages a stocker, reports NPC damage for the wanted rules and makes it retaliate', () => {
    const s = npcSetup(1);
    const a = must(s.players[0]);
    putNpc(s, 'stocker_1', spot(24));
    npcPress(s, a, Button.Attack, 0);
    const hit = s.npcEvents.find((e) => e.type === 'npcHit')?.payload as NpcHitMessage | undefined;
    expect(hit).toMatchObject({
      npc: 'stocker_1',
      source: { kind: 'player', id: a.sessionId },
      damage: fistDamage,
    });
    const npc = must(s.state.npcs.get('stocker_1'));
    expect(npc.hp).toBe(must(stocker.hp) - fistDamage);
    expect(s.npcHits).toEqual([
      { attacker: a.sessionId, victim: { kind: 'npc', id: 'stocker_1' }, damage: fistDamage },
    ]);
    expect(npc.mode).toBe('angry');
    expect(npc.target).toBe(a.sessionId);

    // It swings back: 8 damage from an NPC source, and an npcAttack event for the swing FX.
    npcIdle(s, 2);
    const back = hitsOn(s.events, a.sessionId);
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]).toMatchObject({
      source: { kind: 'npc', id: 'stocker_1' },
      damage: stocker.retaliation.melee.damage,
    });
    expect(s.npcEvents.some((e) => e.type === 'npcAttack')).toBe(true);
    // NPC hits are never NPC damage for the wanted rules.
    expect(s.npcHits).toHaveLength(1);

    // Calms down after retaliation.seconds and goes back to work.
    npcIdle(s, stocker.retaliation.seconds);
    expect(npc.mode).not.toBe('angry');
    expect(npc.target).toBe('');
  });

  it('chases its attacker who runs away', () => {
    const s = npcSetup(1);
    const a = must(s.players[0]);
    putNpc(s, 'stocker_1', spot(24));
    npcPress(s, a, Button.Attack, 0);
    a.x += 96;
    const npc = must(s.state.npcs.get('stocker_1'));
    const d0 = Math.hypot(npc.x - a.x, npc.y - a.y);
    let moved = false;
    // After the punch's shove ends, it walks after them.
    npcIdle(s, 0.4, () => (moved ||= npc.moving));
    expect(moved).toBe(true);
    expect(Math.hypot(npc.x - a.x, npc.y - a.y)).toBeLessThan(d0);
  });

  it('a KO takes the NPC out for npcRespawnSeconds, then it is back at its spawn with full HP', () => {
    const s = npcSetup(1);
    const a = must(s.players[0]);
    const npc = must(s.state.npcs.get('stocker_2'));
    const spawn = { x: npc.x, y: npc.y };
    putNpc(s, 'stocker_2', spot(200));
    s.combat.externalHit({
      source: { kind: 'player', id: a.sessionId },
      target: 'stocker_2',
      damage: 999,
      delivery: 'melee',
    });
    expect(npc.alive).toBe(false);
    expect(npc.hp).toBe(0);
    expect(npc.mode).toBe('ko');
    expect(s.npcEvents.find((e) => e.type === 'npcKo')?.payload).toMatchObject({
      npc: 'stocker_2',
      respawnInSeconds: config.npcRespawnSeconds,
    });
    npcTick(s);
    expect(npc.respawnIn).toBe(Math.ceil(config.npcRespawnSeconds - s.now));
    // Not a target while down.
    expect(s.npcs.canHit({ kind: 'player', id: a.sessionId }, 'stocker_2')).toBe(false);
    expect(s.npcs.bodies().some((b) => b.id === 'stocker_2')).toBe(false);

    npcIdle(s, config.npcRespawnSeconds);
    expect(npc.alive).toBe(true);
    expect(npc.hp).toBe(stocker.hp);
    expect(npc.respawnIn).toBe(0);
    expect(s.npcEvents.some((e) => e.type === 'npcRespawn')).toBe(true);
    // Respawned at its spawn (it may have walked a few ticks since).
    expect(Math.hypot(npc.x - spawn.x, npc.y - spawn.y)).toBeLessThan(stocker.speedPxPerSecond * 0.2 + 33);
  });

  it('the pallet jack dash knocks down a stocker in its line', () => {
    const s = npcSetup(1);
    const a = must(s.players[0]);
    give(s, a, 'pallet_jack');
    putNpc(s, 'stocker_1', spot(60));
    const jack = weapons.require('pallet_jack');
    if (jack.behaviour !== 'charge') throw new Error('not a charge');
    npcPress(s, a, Button.Attack, 0);
    npcIdle(s, 0.5);
    const hit = s.npcEvents.find((e) => e.type === 'npcHit')?.payload as NpcHitMessage | undefined;
    expect(hit).toMatchObject({ npc: 'stocker_1', damage: jack.charge.damage, weapon: 'pallet_jack' });
    const npc = must(s.state.npcs.get('stocker_1'));
    expect(npc.hp).toBe(must(stocker.hp) - jack.charge.damage);
  });

  it('a hit with a stun stops the NPC until the stun runs out', () => {
    const s = npcSetup(1);
    const a = must(s.players[0]);
    putNpc(s, 'stocker_1', spot(200));
    s.combat.externalHit({
      source: { kind: 'player', id: a.sessionId },
      target: 'stocker_1',
      damage: 1,
      stunSeconds: 1,
      delivery: 'melee',
    });
    const npc = must(s.state.npcs.get('stocker_1'));
    const at = { x: npc.x, y: npc.y };
    npcIdle(s, 0.5);
    expect(npc.stunned).toBe(true);
    expect({ x: npc.x, y: npc.y }).toEqual(at);
    npcIdle(s, 0.6);
    expect(npc.stunned).toBe(false);
  });

  it('stock carts block their tiles in the live grid, never on a body, and go away after their time', () => {
    let placed = false;
    const parker: NpcBehaviourModule = {
      behaviour: 'stocker',
      spawn: () => undefined,
      tick(ctx, npc) {
        if (placed || npc.id !== 'stocker_1') return;
        placed = true;
        const rect = ctx.placeStockCart(npc, 2, 1);
        expect(rect).not.toBeNull();
      },
    };
    const s = npcSetup(1, undefined, { modules: [parker] });
    // In an aisle away from the dock.
    const npc = must(s.state.npcs.get('stocker_1'));
    npcTick(s);
    expect(s.state.stockCarts.size).toBe(1);
    const cart = must([...s.state.stockCarts.values()][0]);
    expect(cart.npc).toBe('stocker_1');
    expect(cart.w * cart.h).toBe(2);
    for (const { tx, ty } of rectTiles(cart)) {
      expect(s.live.collision.isSolid(tx, ty)).toBe(true);
      expect(s.npcs.isCartTile(tx, ty)).toBe(true);
      expect(s.live.zoneAt((tx + 0.5) * 32, (ty + 0.5) * 32)?.id).not.toBe('loading_dock');
    }
    // Not on the stocker's own body.
    const half = { hw: stocker.hitboxPx / 2, hh: stocker.hitboxPx / 2 };
    expect(aabbOverlapsSolid(s.live.collision, npc, half)).toBe(false);
    npcIdle(s, 1.1);
    expect(s.state.stockCarts.size).toBe(0);
    expect(s.live.collision.isSolid(cart.tx, cart.ty)).toBe(false);
  });

  it('the real stocker sometimes parks a cart during a long shift', () => {
    const s = npcSetup(8, undefined, { roundPlayers: 8 });
    let seen = 0;
    npcIdle(s, 90, () => {
      seen = Math.max(seen, s.state.stockCarts.size);
    });
    expect(seen).toBeGreaterThan(0);
  });

  describe('swing targets (M5 review F2, F6)', () => {
    /** A stocker module that swings once, right (aim 0), with a long reach, at whoever is there. */
    function swinger(hits: string[][]): NpcBehaviourModule {
      if (stocker.behaviour !== 'stocker') throw new Error('stocker is not a stocker');
      const melee = { ...stocker.retaliation.melee, rangePx: 60 };
      let done = false;
      return {
        behaviour: 'stocker',
        spawn: () => undefined,
        tick(ctx, npc) {
          if (done || npc.id !== 'stocker_1') return;
          done = true;
          hits.push(ctx.swing(npc, { aim: 0, melee }));
        },
      };
    }

    /** A wall one tile thick with open floor two tiles either side, over 3 rows. */
    function thinWall(s: NpcSetup): { left: number; y: number } {
      const grid = s.live.collision;
      const open = (tx: number, ty: number) => !grid.isSolid(tx, ty);
      for (let ty = 2; ty < grid.height - 2; ty++) {
        for (let tx = 3; tx < grid.width - 3; tx++) {
          const ok = [-1, 0, 1].every(
            (dy) =>
              !open(tx, ty + dy) && [1, 2].every((dx) => open(tx - dx, ty + dy) && open(tx + dx, ty + dy)),
          );
          if (ok) return { left: tx * grid.tileSize, y: ty * grid.tileSize + grid.tileSize / 2 };
        }
      }
      throw new Error('no thin wall on the map');
    }

    it('a swing does not reach a player behind a wall; on open floor at the same distance it does', () => {
      const hits: string[][] = [];
      const s = npcSetup(1, undefined, { modules: [swinger(hits)] });
      const a = must(s.players[0]);
      const wall = thinWall(s);
      putNpc(s, 'stocker_1', { x: wall.left - 4, y: wall.y });
      a.x = wall.left + 40;
      a.y = wall.y;
      npcTick(s);
      expect(hits).toEqual([[]]);
      expect(a.hp).toBe(config.maxHp);

      const hits2: string[][] = [];
      const open = npcSetup(1, undefined, { modules: [swinger(hits2)] });
      const b = must(open.players[0]);
      putNpc(open, 'stocker_1', { x: b.x - 44, y: b.y });
      npcTick(open);
      expect(hits2).toEqual([[b.sessionId]]);
    });

    it('ignores a disconnected body: no swing lands, no target, not in ctx.players()', () => {
      const hits: string[][] = [];
      const seen: number[] = [];
      const s = npcSetup(1, undefined, {
        modules: [
          swinger(hits),
          {
            behaviour: 'security',
            spawn: () => undefined,
            tick(ctx) {
              seen.push(ctx.players().length + (ctx.player('p0') ? 10 : 0));
            },
          },
        ],
      });
      const a = must(s.players[0]);
      a.connected = false;
      putNpc(s, 'stocker_1', { x: a.x - 20, y: a.y });
      npcTick(s);
      expect(hits).toEqual([[]]);
      expect(a.hp).toBe(config.maxHp);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((n) => n === 0)).toBe(true);
    });
  });

  it('reset clears NPCs and carts', () => {
    const s = npcSetup(1);
    s.npcs.reset();
    expect(s.state.npcs.size).toBe(0);
    expect(s.state.stockCarts.size).toBe(0);
    expect(s.npcs.bodies()).toEqual([]);
  });
});
