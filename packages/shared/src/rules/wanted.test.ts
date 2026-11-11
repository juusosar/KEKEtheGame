import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import type { Zone } from '../map/mapModel';
import type { Vec2 } from '../types';
import type { CombatEvent } from './combat';
import { gridFrom } from './testGrid';
import {
  applyWantedHits,
  clearWanted,
  createWantedWorld,
  expireWanted,
  findWanted,
  inWantedZone,
  isWanted,
  markWanted,
  removeWantedPlayer,
  updateWantedZones,
  wantedHitsFromCombat,
  wantedPlayers,
  wantedSecondsLeft,
  witnessingGuard,
  type WantedHit,
  type WantedWorld,
  type WitnessContext,
} from './wanted';

const config = { tileSize: 32, wantedSeconds: 20, wantedGuardRangeTiles: 6 };
const TILE = 32;

function ctx(
  positions: Record<string, Vec2>,
  guards: WitnessContext['guards'],
  grid?: WitnessContext['grid'],
) {
  return { guards, positionOf: (id: string) => positions[id], ...(grid ? { grid } : {}) };
}

const playerHit = (attacker: string, victim: string, damage = 10): WantedHit => ({
  attacker,
  victim: { kind: 'player', id: victim },
  damage,
});
const npcHit = (attacker: string, npc: string, damage = 10): WantedHit => ({
  attacker,
  victim: { kind: 'npc', id: npc },
  damage,
});

function rectZone(id: string, x0: number, y0: number, x1: number, y1: number, wantedOnEnter: boolean): Zone {
  return {
    id,
    polygon: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    area: (x1 - x0) * (y1 - y0),
    wantedOnEnter,
  };
}

describe('wanted config', () => {
  it('uses the §6/§8 numbers: 20 s, guards see 6 tiles', () => {
    expect(loadConfig().wantedSeconds).toBe(20);
    expect(loadConfig().wantedGuardRangeTiles).toBe(6);
  });
});

describe('markWanted / isWanted / expireWanted', () => {
  it('makes a player Wanted for wantedSeconds and ends it with an event', () => {
    const r = markWanted(createWantedWorld(), 'a', 'npc_damage', 10, config, { npc: 'stocker-1' });
    expect(r.events).toEqual([
      { type: 'wanted', player: 'a', until: 30, reason: 'npc_damage', refreshed: false, npc: 'stocker-1' },
    ]);
    expect(isWanted(r.world, 'a', 10)).toBe(true);
    expect(isWanted(r.world, 'a', 29.99)).toBe(true);
    expect(isWanted(r.world, 'a', 30)).toBe(false);
    expect(isWanted(r.world, 'b', 10)).toBe(false);
    expect(wantedSecondsLeft(r.world, 'a', 25)).toBe(5);
    expect(wantedSecondsLeft(r.world, 'b', 25)).toBe(0);

    const before = expireWanted(r.world, 29);
    expect(before.events).toEqual([]);
    expect(before.world).toBe(r.world);
    const after = expireWanted(r.world, 30);
    expect(after.events).toEqual([{ type: 'wantedEnded', player: 'a' }]);
    expect(findWanted(after.world, 'a')?.until).toBeNull();
    expect(expireWanted(after.world, 31).events).toEqual([]);
  });

  it('a new offence restarts the full 20 s and says so', () => {
    const w = markWanted(createWantedWorld(), 'a', 'npc_damage', 0, config).world;
    const r = markWanted(w, 'a', 'npc_damage', 15, config);
    expect(r.events[0]).toMatchObject({ until: 35, refreshed: true });
    expect(isWanted(r.world, 'a', 34)).toBe(true);
  });

  it('after it ran out, a new offence is a fresh start, not a refresh', () => {
    const w = markWanted(createWantedWorld(), 'a', 'npc_damage', 0, config).world;
    expect(markWanted(w, 'a', 'npc_damage', 25, config).events[0]).toMatchObject({
      refreshed: false,
      until: 45,
    });
  });

  it('is immutable and lists Wanted players in order', () => {
    const empty = createWantedWorld();
    let w: WantedWorld = markWanted(empty, 'b', 'zone', 0, config).world;
    w = markWanted(w, 'a', 'zone', 5, config).world;
    expect(empty.players).toEqual([]);
    expect(wantedPlayers(w, 10)).toEqual(['b', 'a']);
    expect(wantedPlayers(w, 22)).toEqual(['a']);
    expect(wantedPlayers(removeWantedPlayer(w, 'a'), 10)).toEqual(['b']);
  });
});

describe('clearWanted (KO, playtest 1)', () => {
  it('ends the status of the given players only, with one event each', () => {
    let w: WantedWorld = markWanted(createWantedWorld(), 'a', 'npc_damage', 0, config).world;
    w = markWanted(w, 'b', 'npc_damage', 0, config).world;
    const r = clearWanted(w, ['a', 'c']);
    expect(r.events).toEqual([{ type: 'wantedEnded', player: 'a' }]);
    expect(isWanted(r.world, 'a', 1)).toBe(false);
    expect(isWanted(r.world, 'b', 1)).toBe(true);
    expect(clearWanted(r.world, ['a'])).toEqual({ world: r.world, events: [] });
  });

  it('drops the zone flag, so a KO inside staff_only starts no timer on respawn', () => {
    let w = updateWantedZones(createWantedWorld(), [{ id: 'a', inZone: true }], 0, config).world;
    w = clearWanted(w, ['a']).world;
    expect(findWanted(w, 'a')).toMatchObject({ until: null, inZone: false });
    const after = updateWantedZones(w, [{ id: 'a', inZone: false }], 1, config);
    expect(after.events).toEqual([]);
    expect(isWanted(after.world, 'a', 1)).toBe(false);
  });
});

describe('witnessingGuard', () => {
  const guard = { id: 'g1', x: 100, y: 100 };

  it('sees within 6 tiles, the edge included, and not beyond', () => {
    expect(witnessingGuard({ x: 100 + 6 * TILE, y: 100 }, [guard], config)).toBe(guard);
    expect(witnessingGuard({ x: 100 + 6 * TILE + 1, y: 100 }, [guard], config)).toBeUndefined();
    expect(witnessingGuard({ x: 100, y: 100 }, [], config)).toBeUndefined();
  });

  it('does not see through walls', () => {
    const grid = gridFrom([
      '..........', //
      '....#.....',
      '..........',
    ]);
    const g = { id: 'g', x: 16, y: 48 };
    expect(witnessingGuard({ x: 5 * TILE + 16, y: 48 }, [g], config, grid)).toBeUndefined();
    expect(witnessingGuard({ x: 5 * TILE + 16, y: 16 }, [g], config, grid)).toBe(g);
  });

  it('returns the first guard in input order that sees', () => {
    const far = { id: 'far', x: 1000, y: 0 };
    const g2 = { id: 'g2', x: 0, y: 50 };
    const g3 = { id: 'g3', x: 0, y: 10 };
    expect(witnessingGuard({ x: 0, y: 0 }, [far, g2, g3], config)?.id).toBe('g2');
  });
});

describe('applyWantedHits', () => {
  it('damaging any NPC makes the attacker Wanted, wherever the guards are', () => {
    const r = applyWantedHits(createWantedWorld(), [npcHit('a', 'stocker-1')], ctx({}, []), 3, config);
    expect(isWanted(r.world, 'a', 3)).toBe(true);
    expect(r.events).toEqual([
      { type: 'wanted', player: 'a', until: 23, reason: 'npc_damage', refreshed: false, npc: 'stocker-1' },
    ]);
  });

  it('damaging a guard itself also counts (it is an NPC)', () => {
    const r = applyWantedHits(createWantedWorld(), [npcHit('a', 'guard-1', 5)], ctx({}, []), 0, config);
    expect(isWanted(r.world, 'a', 0)).toBe(true);
  });

  it('damaging a player is an offence only when a guard sees the attacker or the victim', () => {
    const guards = [{ id: 'g1', x: 0, y: 0 }];
    const near = { x: 3 * TILE, y: 0 };
    const away = { x: 50 * TILE, y: 0 };

    const unseen = applyWantedHits(
      createWantedWorld(),
      [playerHit('a', 'b')],
      ctx({ a: away, b: away }, guards),
      0,
      config,
    );
    expect(unseen.events).toEqual([]);
    expect(isWanted(unseen.world, 'a', 0)).toBe(false);

    const attackerSeen = applyWantedHits(
      createWantedWorld(),
      [playerHit('a', 'b')],
      ctx({ a: near, b: away }, guards),
      0,
      config,
    );
    expect(attackerSeen.events).toEqual([
      { type: 'wanted', player: 'a', until: 20, reason: 'witnessed', refreshed: false, guard: 'g1' },
    ]);
    expect(isWanted(attackerSeen.world, 'b', 0)).toBe(false);

    // A ranged shot from out of sight onto a victim standing next to a guard.
    const victimSeen = applyWantedHits(
      createWantedWorld(),
      [playerHit('a', 'b')],
      ctx({ a: away, b: near }, guards),
      0,
      config,
    );
    expect(isWanted(victimSeen.world, 'a', 0)).toBe(true);
  });

  it('a wall between the guard and both players hides the fight', () => {
    const grid = gridFrom([
      '..........', //
      '..#.......',
      '..#.......',
    ]);
    const guards = [{ id: 'g1', x: 16, y: 80 }];
    const positions = { a: { x: 5 * TILE, y: 80 }, b: { x: 6 * TILE, y: 80 } };
    const hidden = applyWantedHits(
      createWantedWorld(),
      [playerHit('a', 'b')],
      ctx(positions, guards, grid),
      0,
      config,
    );
    expect(hidden.events).toEqual([]);
    const open = applyWantedHits(
      createWantedWorld(),
      [playerHit('a', 'b')],
      ctx(positions, guards),
      0,
      config,
    );
    expect(open.events).toHaveLength(1);
  });

  it('ignores 0-damage hits (slips, pushes), self hits and unknown positions', () => {
    const guards = [{ id: 'g1', x: 0, y: 0 }];
    const here = { x: 10, y: 0 };
    const r = applyWantedHits(
      createWantedWorld(),
      [playerHit('a', 'b', 0), npcHit('a', 'stocker-1', 0), playerHit('a', 'a', 10), playerHit('c', 'd')],
      ctx({ a: here, b: here }, guards),
      0,
      config,
    );
    expect(r.events).toEqual([]);
    expect(r.world.players).toEqual([]);
  });

  it('is per player with Teams on: only the attacker becomes Wanted', () => {
    const guards = [{ id: 'g1', x: 0, y: 0 }];
    const here = { x: 10, y: 0 };
    const r = applyWantedHits(
      createWantedWorld(),
      [playerHit('red1', 'blue1'), npcHit('blue2', 'stocker-1')],
      ctx({ red1: here, blue1: here, red2: here }, guards),
      0,
      config,
    );
    expect(wantedPlayers(r.world, 0)).toEqual(['red1', 'blue2']);
  });

  it('several hits in one tick: one event per offence, the timer refreshed', () => {
    const w = markWanted(createWantedWorld(), 'a', 'zone', 0, config).world;
    const r = applyWantedHits(w, [npcHit('a', 'n1'), npcHit('a', 'n2')], ctx({}, []), 10, config);
    expect(r.events.map((e) => e.type === 'wanted' && e.refreshed)).toEqual([true, true]);
    expect(findWanted(r.world, 'a')?.until).toBe(30);
  });
});

describe('wantedHitsFromCombat', () => {
  it('keeps landed player-on-player damage only', () => {
    const events: CombatEvent[] = [
      { type: 'hit', source: { kind: 'player', id: 'a' }, target: 'b', damage: 10, weapon: 'fists', hp: 90 },
      {
        type: 'hit',
        source: { kind: 'player', id: 'a' },
        target: 'b',
        damage: 0,
        weapon: 'banana_peels',
        hp: 90,
      },
      { type: 'hit', source: { kind: 'player', id: 'a' }, target: 'a', damage: 5, weapon: null, hp: 95 },
      { type: 'hit', source: { kind: 'npc', id: 'guard-1' }, target: 'a', damage: 15, weapon: null, hp: 80 },
      {
        type: 'hit',
        source: { kind: 'hazard', id: 'forklift-1' },
        target: 'b',
        damage: 25,
        weapon: null,
        hp: 65,
      },
      { type: 'ko', player: 'b', source: { kind: 'player', id: 'a' }, weapon: 'fists', respawnAt: 3 },
    ];
    expect(wantedHitsFromCombat(events)).toEqual([playerHit('a', 'b', 10)]);
  });
});

describe('wantedOnEnter zones', () => {
  const staff = rectZone('staff_only', 0, 0, 100, 100, true);
  const dry = rectZone('dry_goods', 100, 0, 300, 100, false);
  const nested = rectZone('outer', 300, 0, 500, 100, false);
  const inner = rectZone('inner', 350, 0, 400, 100, true);

  it('inWantedZone checks every zone at the point, nested ones included', () => {
    expect(inWantedZone([staff, dry], 50, 50)).toBe(true);
    expect(inWantedZone([staff, dry], 150, 50)).toBe(false);
    expect(inWantedZone([nested, inner], 360, 50)).toBe(true);
    expect(inWantedZone([nested, inner], 320, 50)).toBe(false);
  });

  it('entering makes you Wanted; staying holds the timer; leaving starts the 20 s', () => {
    let w = createWantedWorld();
    let r = updateWantedZones(w, [{ id: 'a', inZone: false }], 0, config);
    expect(r.events).toEqual([]);
    w = r.world;

    r = updateWantedZones(w, [{ id: 'a', inZone: true }], 1, config);
    expect(r.events).toEqual([{ type: 'wanted', player: 'a', until: 21, reason: 'zone', refreshed: false }]);
    w = r.world;

    r = updateWantedZones(w, [{ id: 'a', inZone: true }], 40, config);
    expect(r.events).toEqual([]);
    expect(findWanted(r.world, 'a')?.until).toBe(60);
    expect(expireWanted(r.world, 40).events).toEqual([]);
    w = r.world;

    r = updateWantedZones(w, [{ id: 'a', inZone: false }], 41, config);
    expect(r.events).toEqual([]);
    w = r.world;
    expect(isWanted(w, 'a', 59)).toBe(true);
    expect(expireWanted(w, 60).events).toEqual([{ type: 'wantedEnded', player: 'a' }]);

    // Stepping back in is a new entry.
    r = updateWantedZones(expireWanted(w, 60).world, [{ id: 'a', inZone: true }], 70, config);
    expect(r.events).toMatchObject([{ type: 'wanted', reason: 'zone', refreshed: false }]);
  });

  it('entering while already Wanted refreshes and says so', () => {
    const w = markWanted(createWantedWorld(), 'a', 'npc_damage', 0, config).world;
    const r = updateWantedZones(w, [{ id: 'a', inZone: true }], 5, config);
    expect(r.events).toEqual([{ type: 'wanted', player: 'a', until: 25, reason: 'zone', refreshed: true }]);
  });

  it('a player who leaves and rejoins is forgotten', () => {
    const w = updateWantedZones(createWantedWorld(), [{ id: 'a', inZone: true }], 0, config).world;
    expect(findWanted(removeWantedPlayer(w, 'a'), 'a')).toBeUndefined();
  });
});
