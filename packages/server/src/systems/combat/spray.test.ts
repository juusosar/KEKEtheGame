// The spray module (M4-4) inside a CombatSystem, without a network: players placed by hand on open floor
// next to van 0, frames fed through afterFrame, ticks stepped with an explicit round clock.
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
let map: MapModel;

beforeAll(() => {
  map = loadThemeMap(getTheme(defaultThemeId));
});

function sprayOf(id: string) {
  const def = weapons.require(id);
  if (def.behaviour !== 'spray') throw new Error(`${id} is not a spray`);
  return def.spray;
}

interface Setup {
  combat: CombatSystem;
  events: CombatEventWire[];
  players: PlayerState[];
  now: number;
}

function setup(count: number, teams?: (i: number) => number): Setup {
  const state = new GameState();
  state.settings.teams = teams !== undefined;
  const base = vanSpawn(map, 0, playerHalfSize(config));
  const players: PlayerState[] = [];
  for (let i = 0; i < count; i++) {
    const p = new PlayerState();
    p.sessionId = `p${i}`;
    p.joinOrder = i;
    p.van = 0;
    p.team = teams?.(i) ?? 0;
    p.x = base.x + i * 30;
    p.y = base.y;
    state.players.set(p.sessionId, p);
    players.push(p);
  }
  const events: CombatEventWire[] = [];
  const combat = new CombatSystem(state, config, map, (e) => events.push(e), { onKo: () => undefined }, 1);
  combat.startRound(players);
  return { combat, events, players, now: 0 };
}

function give(s: Setup, p: PlayerState, weapon: string): void {
  for (let i = 0; i < 500 && p.weapon !== weapon; i++) s.combat.onPickup(p.sessionId, 'item');
  expect(p.weapon).toBe(weapon);
}

let seq = 0;
function frame(buttons: number, aim = 0): InputFrame {
  return { seq: ++seq, move: { x: 0, y: 0 }, aim, buttons };
}

/** One server tick; `sprayer` applies one frame holding `buttons` (Attack by default), aiming at `aim`. */
function tick(s: Setup, sprayer?: PlayerState, aim = 0, buttons = Button.Attack, pressed = 0): void {
  s.now += TICK;
  s.combat.beginTick(s.now);
  if (sprayer) s.combat.afterFrame(sprayer, frame(buttons, aim), pressed);
  s.combat.tick(s.now);
}

/** Holds Attack for `seconds` of round time (one frame per server tick). */
function hold(s: Setup, sprayer: PlayerState, seconds: number, aim = 0): void {
  const until = s.now + seconds;
  while (s.now < until - 1e-9) tick(s, sprayer, aim);
}

const count = (s: Setup, type: string): number => s.events.filter((e) => e.type === type).length;

describe('spray: ketchup bottle', () => {
  const ketchup = sprayOf('ketchup_bottle');

  it('a tick at once: 3 damage, a 40% slow, a quarter second of spray spent', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'ketchup_bottle');
    tick(s, a);
    expect(b.hp).toBe(config.maxHp - ketchup.damagePerTick);
    expect(b.slowMultiplier).toBeCloseTo(0.6, 5);
    expect(a.weaponUses).toBeCloseTo(3 - 0.25, 5);
    expect(s.events.slice(-2).map((e) => e.type)).toEqual(['attack', 'hit']);
    expect(s.events.at(-2)).toMatchObject({
      type: 'attack',
      payload: { mode: 'spray', weapon: 'ketchup_bottle' },
    });
  });

  it('one tick per 0.25 s while held, and tapping cannot go faster', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'ketchup_bottle');
    hold(s, a, 1); // ticks at 0.05, 0.30, 0.55, 0.80
    expect(b.hp).toBe(config.maxHp - 4 * ketchup.damagePerTick);
    const hpAfterHold = b.hp;
    // Release and press every server tick for 0.5 s: still one tick per 0.25 s.
    for (let i = 0; i < 10; i++) {
      tick(s, a, 0, i % 2 === 0 ? Button.Attack : 0, i % 2 === 0 ? Button.Attack : 0);
    }
    expect(hpAfterHold - b.hp).toBe(2 * ketchup.damagePerTick);
  });

  it('3 s of spray: 12 ticks, then the bottle is spent and the player is back to fists', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'ketchup_bottle');
    hold(s, a, 4);
    expect(b.hp).toBe(config.maxHp - 12 * ketchup.damagePerTick);
    expect(a.weapon).toBe('fists');
    expect(count(s, 'weaponSpent')).toBe(1);
    expect(count(s, 'attack')).toBe(12);
  });

  it('the slow wears off 1.5 s after the last tick', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'ketchup_bottle');
    tick(s, a);
    expect(b.slowMultiplier).toBeLessThan(1);
    for (let t = 0; t < 1.4; t += TICK) tick(s);
    expect(b.slowMultiplier).toBeLessThan(1);
    for (let t = 0; t < 0.2; t += TICK) tick(s);
    expect(b.slowMultiplier).toBe(1);
  });

  it('misses when aimed away, and never hits a teammate (§3.3)', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'ketchup_bottle');
    tick(s, a, Math.PI);
    expect(b.hp).toBe(config.maxHp);

    const t = setup(2, () => 1);
    const [ta, tb] = t.players as [PlayerState, PlayerState];
    give(t, ta, 'ketchup_bottle');
    tick(t, ta);
    expect(tb.hp).toBe(config.maxHp);
    expect(tb.slowMultiplier).toBe(1);
  });

  it('only sprays while Attack is held', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'ketchup_bottle');
    tick(s, a, 0, 0);
    expect(b.hp).toBe(config.maxHp);
    expect(a.weaponUses).toBe(3);
  });
});

describe('spray: fire extinguisher', () => {
  const ext = sprayOf('fire_extinguisher');

  it('pushes everyone in the cone away without damage or hit events', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'fire_extinguisher');
    const x0 = b.x;
    tick(s, a);
    for (let i = 0; i < 4; i++) tick(s); // let the shove play out (knockbackSeconds)
    expect(b.hp).toBe(config.maxHp);
    expect(count(s, 'hit')).toBe(0);
    expect(count(s, 'attack')).toBe(1);
    expect(b.x - x0).toBeCloseTo(ext.pushPxPerSecond * ext.tickSeconds, 3);
    expect(Math.abs(b.y - a.y)).toBeLessThan(1e-6);
  });

  it('keeps pushing while held: about pushPxPerSecond until out of the cone or against a wall', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'fire_extinguisher');
    const x0 = b.x;
    hold(s, a, 0.5); // ticks at 0.05 and 0.30
    for (let i = 0; i < 4; i++) tick(s);
    expect(b.x - x0).toBeGreaterThan(ext.pushPxPerSecond * ext.tickSeconds);
    expect(a.weaponUses).toBeCloseTo(4 - 0.5, 5);
  });

  it('does not push a teammate', () => {
    const s = setup(2, () => 2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'fire_extinguisher');
    const x0 = b.x;
    hold(s, a, 0.3);
    expect(b.x).toBe(x0);
  });
});
