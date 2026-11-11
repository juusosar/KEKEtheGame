// The banana peel trap module (M4-5) inside a CombatSystem without a network, like CombatSystem.test.ts.
import {
  Button,
  defaultThemeId,
  getTheme,
  getWeaponCatalogue,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type CombatEventWire,
  type InputFrame,
  type MapModel,
} from '@keke/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadThemeMap } from '../../maps';
import { GameState, PlayerState } from '../../schema/GameState';
import { CombatSystem } from './CombatSystem';

const config = loadConfig({ ...loadConfig(), roundStartProtectionSeconds: 0 });
const weapons = getWeaponCatalogue();
const TICK = 1 / config.serverTickHz;
const peelDef = weapons.require('banana_peels');
if (peelDef.behaviour !== 'trap') throw new Error('banana_peels is not a trap');
const stats = peelDef.trap;
let map: MapModel;

beforeAll(() => {
  map = loadThemeMap(getTheme(defaultThemeId));
});

function spot(dx = 0, dy = 0): { x: number; y: number } {
  const base = vanSpawn(map, 0, playerHalfSize(config));
  return { x: base.x + dx, y: base.y + dy };
}

interface Setup {
  state: GameState;
  combat: CombatSystem;
  events: CombatEventWire[];
  drops: string[];
  players: PlayerState[];
  now: number;
}

function setup(count: number, team: (i: number) => number = () => 0): Setup {
  const state = new GameState();
  state.settings.teams = count > 0 && team(0) > 0;
  const players: PlayerState[] = [];
  for (let i = 0; i < count; i++) {
    const p = new PlayerState();
    p.sessionId = `p${i}`;
    p.joinOrder = i;
    p.van = 0;
    p.team = team(i);
    const at = spot(0, i * 60);
    p.x = at.x;
    p.y = at.y;
    state.players.set(p.sessionId, p);
    players.push(p);
  }
  const events: CombatEventWire[] = [];
  const drops: string[] = [];
  const combat = new CombatSystem(
    state,
    config,
    map,
    (e) => events.push(e),
    { onKo: () => undefined, onDropCarried: (p) => drops.push(p.sessionId) },
    1,
  );
  combat.startRound(players);
  return { state, combat, events, drops, players, now: 0 };
}

let seq = 0;
function frame(buttons: number, aim = 0): InputFrame {
  return { seq: ++seq, move: { x: 0, y: 0 }, aim, buttons };
}

function tick(s: Setup, frames: () => void = () => undefined): void {
  s.now += TICK;
  s.combat.beginTick(s.now);
  frames();
  s.combat.tick(s.now);
}

function idle(s: Setup, seconds: number): void {
  const until = s.now + seconds;
  while (s.now < until - 1e-9) tick(s);
}

function give(s: Setup, p: PlayerState, weapon: string): void {
  for (let i = 0; i < 500 && p.weapon !== weapon; i++) s.combat.onPickup(p.sessionId, 'item');
  expect(p.weapon).toBe(weapon);
}

/** `thrower` drops one peel where they stand. */
function drop(s: Setup, thrower: PlayerState): void {
  tick(s, () => s.combat.afterFrame(thrower, frame(Button.Attack), Button.Attack));
}

function place(p: PlayerState, at: { x: number; y: number }): void {
  p.x = at.x;
  p.y = at.y;
}

function hits(s: Setup): CombatEventWire[] {
  return s.events.filter((e) => e.type === 'hit');
}

describe('banana peels (trap)', () => {
  it('a press drops one synced peel at the feet and spends one of 3 uses', () => {
    const s = setup(1);
    const [a] = s.players as [PlayerState];
    give(s, a, 'banana_peels');
    drop(s, a);
    expect(a.weaponUses).toBe((peelDef.uses ?? 0) - 1);
    expect(s.state.traps.size).toBe(1);
    const peel = [...s.state.traps.values()][0];
    expect(peel).toMatchObject({ weapon: 'banana_peels', owner: 'p0', armed: false });
    expect(peel?.x).toBeCloseTo(a.x);
    expect(peel?.y).toBeCloseTo(a.y);
    // Held Attack is not another press; the cooldown blocks a second press straight away.
    tick(s, () => s.combat.afterFrame(a, frame(Button.Attack), 0));
    drop(s, a);
    expect(s.state.traps.size).toBe(1);
    idle(s, peelDef.cooldownSeconds);
    drop(s, a);
    expect(s.state.traps.size).toBe(2);
  });

  it('arms after the arm delay and never trips its owner', () => {
    const s = setup(1);
    const [a] = s.players as [PlayerState];
    give(s, a, 'banana_peels');
    drop(s, a);
    idle(s, stats.armSeconds + TICK);
    expect([...s.state.traps.values()][0]?.armed).toBe(true);
    idle(s, 1);
    expect(a.sliding).toBe(false);
    expect(hits(s)).toHaveLength(0);
    expect(s.state.traps.size).toBe(1);
  });

  it('a rival who steps on an armed peel slips: 0-damage trap hit, item drop, 1 s uncontrolled slide', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'banana_peels');
    const at = { x: a.x, y: a.y };
    drop(s, a);
    place(a, spot(0, 120));
    // Not armed yet: b stands on it and nothing happens.
    place(b, at);
    tick(s);
    expect(b.sliding).toBe(false);
    idle(s, stats.armSeconds);
    expect(b.sliding).toBe(true);
    expect(b.stunned).toBe(true);
    expect(b.hp).toBe(config.maxHp - stats.damage);
    expect(s.drops).toEqual(['p1']);
    expect(s.state.traps.size).toBe(0);
    expect(hits(s).at(-1)).toMatchObject({
      payload: { source: { kind: 'player', id: 'p0' }, target: 'p1', weapon: 'banana_peels' },
    });
    // Standing still with aim 0: slides towards +x (walls may cut it short), without control.
    const startX = b.x;
    idle(s, stats.slideSeconds / 2);
    expect(b.x).toBeGreaterThan(startX);
    expect(b.sliding).toBe(true);
    idle(s, stats.slideSeconds / 2 + TICK);
    expect(b.sliding).toBe(false);
    expect(b.stunned).toBe(false);
    expect(b.x - startX).toBeLessThanOrEqual(stats.slideSeconds * stats.slideSpeedPxPerSecond + 1e-6);
  });

  it('slides along the way the victim was moving', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'banana_peels');
    const at = { x: a.x, y: a.y };
    drop(s, a);
    place(a, spot(0, 120));
    idle(s, stats.armSeconds);
    place(b, at);
    b.vx = 0;
    b.vy = -100;
    tick(s);
    expect(b.sliding).toBe(true);
    const startY = b.y;
    const startX = b.x;
    idle(s, 0.3);
    expect(b.y).toBeLessThan(startY);
    expect(b.x).toBeCloseTo(startX);
  });

  it('teammates walk over their team peels with Teams on; rivals slip', () => {
    const s = setup(3, (i) => (i < 2 ? 1 : 2));
    const [a, mate, rival] = s.players as [PlayerState, PlayerState, PlayerState];
    give(s, a, 'banana_peels');
    const at = { x: a.x, y: a.y };
    drop(s, a);
    place(a, spot(0, 180));
    place(rival, spot(0, 240));
    idle(s, stats.armSeconds);
    place(mate, at);
    tick(s);
    expect(mate.sliding).toBe(false);
    expect(s.state.traps.size).toBe(1);
    place(mate, spot(0, 120));
    place(rival, at);
    tick(s);
    expect(rival.sliding).toBe(true);
    expect(s.state.traps.size).toBe(0);
  });

  it('expires 45 s after the drop', () => {
    const s = setup(1);
    const [a] = s.players as [PlayerState];
    give(s, a, 'banana_peels');
    drop(s, a);
    const dropped = s.now;
    idle(s, stats.lifetimeSeconds - 1);
    expect(s.state.traps.size).toBe(1);
    while (s.now < dropped + stats.lifetimeSeconds) tick(s);
    expect(s.state.traps.size).toBe(0);
  });

  it('reset clears peels and slides', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'banana_peels');
    const at = { x: a.x, y: a.y };
    drop(s, a);
    idle(s, peelDef.cooldownSeconds);
    place(a, spot(0, 120));
    drop(s, a);
    idle(s, stats.armSeconds);
    place(b, at);
    tick(s);
    expect(b.sliding).toBe(true);
    s.combat.reset();
    expect(s.state.traps.size).toBe(0);
    expect(b.sliding).toBe(false);
  });
});
