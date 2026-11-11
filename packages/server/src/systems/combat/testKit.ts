// Helpers for behaviour module tests without a network (M4-6): a GameState with players placed by hand
// on van 0's open floor, frames fed through afterFrame, and ticks stepped with an explicit round clock.
// Same pattern as CombatSystem.test.ts.
import {
  getTheme,
  getWeaponCatalogue,
  defaultThemeId,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type CombatEventWire,
  type InputFrame,
  type MapModel,
  type Vec2,
} from '@keke/shared';
import { loadThemeMap } from '../../maps';
import { GameState, PlayerState } from '../../schema/GameState';
import { CombatSystem } from './CombatSystem';

export const config = loadConfig({ ...loadConfig(), roundStartProtectionSeconds: 0 });
export const weapons = getWeaponCatalogue();
export const TICK = 1 / config.serverTickHz;

let cachedMap: MapModel | undefined;
export function kesproMap(): MapModel {
  cachedMap ??= loadThemeMap(getTheme(defaultThemeId));
  return cachedMap;
}

/** An open floor spot: van 0's spawn, then `dx`, `dy` pixels away. */
export function spot(dx = 0, dy = 0): Vec2 {
  const base = vanSpawn(kesproMap(), 0, playerHalfSize(config));
  return { x: base.x + dx, y: base.y + dy };
}

export interface Scatter {
  from: Vec2;
  to: Vec2;
  halfWidth: number;
  px: number;
}

export interface Setup {
  state: GameState;
  combat: CombatSystem;
  events: CombatEventWire[];
  scatters: Scatter[];
  players: PlayerState[];
  now: number;
}

export function setup(count: number, at: (i: number) => Vec2 = (i) => spot(i * 30)): Setup {
  const state = new GameState();
  const players: PlayerState[] = [];
  for (let i = 0; i < count; i++) {
    const p = new PlayerState();
    p.sessionId = `p${i}`;
    p.joinOrder = i;
    p.van = 0;
    const pos = at(i);
    p.x = pos.x;
    p.y = pos.y;
    state.players.set(p.sessionId, p);
    players.push(p);
  }
  const events: CombatEventWire[] = [];
  const scatters: Scatter[] = [];
  const combat = new CombatSystem(
    state,
    config,
    kesproMap(),
    (e) => events.push(e),
    {
      onKo: () => undefined,
      onScatterItems: (from, to, halfWidth, px) => scatters.push({ from, to, halfWidth, px }),
    },
    1,
  );
  combat.startRound(players);
  return { state, combat, events, scatters, players, now: 0 };
}

let seq = 0;
export function frame(buttons: number, aim = 0): InputFrame {
  return { seq: ++seq, move: { x: 0, y: 0 }, aim, buttons };
}

export function tick(s: Setup, frames: () => void = () => undefined): void {
  s.now += TICK;
  s.combat.beginTick(s.now);
  frames();
  s.combat.tick(s.now);
}

export function idle(s: Setup, seconds: number): void {
  const until = s.now + seconds;
  while (s.now < until - 1e-9) tick(s);
}

/** One tick in which `p` applied one frame holding `held` with `pressed` edges, aiming at `aim`. */
export function press(s: Setup, p: PlayerState, pressed: number, held = pressed, aim = 0): void {
  tick(s, () => s.combat.afterFrame(p, frame(held, aim), pressed));
}

/** Rolls pickups until `p` holds `weapon` (the RNG is seeded, so this is deterministic). */
export function give(s: Setup, p: PlayerState, weapon: string): void {
  for (let i = 0; i < 500 && p.weapon !== weapon; i++) s.combat.onPickup(p.sessionId, 'item');
  if (p.weapon !== weapon) throw new Error(`could not roll ${weapon}`);
}

/** The value, or a thrown error naming what was missing (tests use this instead of `!`). */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}
