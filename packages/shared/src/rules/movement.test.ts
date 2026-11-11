import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { carryMultiplier, normalizeMove, pushOutOfSolids, step, type MovementState } from './movement';
import { mapFrom } from './testGrid';

const config = loadConfig();
const dt = 1 / config.serverTickHz;
const tick = 160 * dt; // playerSpeed px per server tick = 8

// 10×10 room, interior [32, 288).
const ROOM = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '##########',
];
const open = mapFrom(ROOM);
const icy = mapFrom(ROOM, {
  rect: [0, 0, 320, 320],
  floor: { friction: config.coldRoomFriction, speedMultiplier: config.coldRoomSpeedMultiplier },
});
const start: MovementState = { x: 160, y: 160, vx: 0, vy: 0 };

function run(s: MovementState, move: { x: number; y: number }, ticks: number, map = open): MovementState {
  for (let i = 0; i < ticks; i++) s = step(s, { move }, dt, map, config);
  return s;
}

describe('normalizeMove', () => {
  it('clamps diagonals to unit length and keeps analog input below 1', () => {
    const d = normalizeMove({ x: 1, y: 1 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(normalizeMove({ x: 0.3, y: -0.4 })).toEqual({ x: 0.3, y: -0.4 });
    expect(normalizeMove({ x: Number.NaN, y: 1 })).toEqual({ x: 0, y: 1 });
  });
});

describe('step', () => {
  it('moves at playerSpeed on a normal floor and stops instantly', () => {
    const s = step(start, { move: { x: 1, y: 0 } }, dt, open, config);
    expect(s).toEqual({ x: 160 + tick, y: 160, vx: 160, vy: 0 });
    expect(step(s, { move: { x: 0, y: 0 } }, dt, open, config)).toEqual({ x: s.x, y: 160, vx: 0, vy: 0 });
  });

  it('normalises diagonal input so diagonal speed equals straight speed', () => {
    const s = step(start, { move: { x: 1, y: 1 } }, dt, open, config);
    expect(Math.hypot(s.x - start.x, s.y - start.y)).toBeCloseTo(tick);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(config.playerSpeed);
  });

  it('applies the carry multiplier hook', () => {
    const mult = carryMultiplier(config, true);
    expect(mult).toBe(0.85);
    expect(carryMultiplier(config, false)).toBe(1);
    const s = step(start, { move: { x: 0, y: -1 } }, dt, open, config, { speedMultiplier: mult });
    expect(s.y).toBeCloseTo(160 - tick * 0.85);
  });

  it('applies the zone speed multiplier', () => {
    const slow = mapFrom(ROOM, { rect: [0, 0, 320, 320], floor: { speedMultiplier: 0.5 } });
    expect(step(start, { move: { x: 1, y: 0 } }, dt, slow, config).x).toBeCloseTo(160 + tick / 2);
  });

  it('slides along a wall when moving diagonally into it, and zeroes velocity into the wall', () => {
    const atWall: MovementState = { x: 278, y: 100, vx: 0, vy: 0 }; // flush with the right wall (288 − 10)
    const s = step(atWall, { move: { x: 1, y: 1 } }, dt, open, config);
    expect(s.x).toBe(278);
    expect(s.y).toBeCloseTo(100 + tick * Math.SQRT1_2);
    expect(s.vx).toBe(0);
    expect(s.vy).toBeGreaterThan(0);
  });

  it('ends up wedged in a corner, never inside a wall', () => {
    const s = run(start, { x: -1, y: -1 }, 60);
    expect(s).toEqual({ x: 42, y: 42, vx: 0, vy: 0 });
  });

  it('keeps momentum on a slippery floor after input stops', () => {
    const moving = run(start, { x: 1, y: 0 }, 1, icy);
    // One icy tick from rest only reaches (1 − friction) of the target speed.
    expect(moving.vx).toBeCloseTo(160 * 0.9 * (1 - 0.92));
    const fast = run({ ...start, x: 42 }, { x: 1, y: 0 }, 25, icy);
    expect(fast.vx).toBeGreaterThan(120);
    const coasting = step({ ...fast, x: 100 }, { move: { x: 0, y: 0 } }, dt, icy, config);
    expect(coasting.vx).toBeCloseTo(fast.vx * 0.92);
    expect(coasting.x).toBeGreaterThan(100);
  });

  it('slows down gradually when reversing on ice instead of turning instantly', () => {
    const fast: MovementState = { x: 100, y: 160, vx: 144, vy: 0 };
    const s = step(fast, { move: { x: -1, y: 0 } }, dt, icy, config);
    expect(s.vx).toBeGreaterThan(0);
    expect(s.vx).toBeLessThan(144);
  });

  it('scales friction to dt so 3 small steps match one server tick', () => {
    const coast: MovementState = { x: 100, y: 160, vx: 100, vy: 0 };
    const one = step(coast, { move: { x: 0, y: 0 } }, dt, icy, config);
    let three = coast;
    for (let i = 0; i < 3; i++) three = step(three, { move: { x: 0, y: 0 } }, dt / 3, icy, config);
    expect(three.vx).toBeCloseTo(one.vx, 10);
  });

  it('stops sliding against a wall on ice', () => {
    const s = run({ x: 200, y: 160, vx: 150, vy: 0 }, { x: 0, y: 0 }, 30, icy);
    expect(s.x).toBeLessThanOrEqual(278);
    expect(s.vx).toBe(0);
  });

  it('returns the state unchanged for non-positive dt', () => {
    expect(step(start, { move: { x: 1, y: 0 } }, 0, open, config)).toBe(start);
    expect(step(start, { move: { x: 1, y: 0 } }, -1, open, config)).toBe(start);
  });

  it('is deterministic: the same inputs give bit-identical results', () => {
    const inputs = Array.from({ length: 200 }, (_, i) => ({
      x: Math.sin(i * 0.37),
      y: Math.cos(i * 0.21),
    }));
    const simulate = () => {
      let s = start;
      for (const move of inputs) s = step(s, { move }, dt, icy, config);
      return s;
    };
    expect(simulate()).toEqual(simulate());
  });
});

describe('solid bodies (Phase 2 decision 8: customers)', () => {
  const r = config.playerHitboxSize / 2;
  const body = { x: 200, y: 160, r: 10 };

  it('stops a player walking into a body at the touching distance', () => {
    let s = start;
    for (let i = 0; i < 40; i++) s = step(s, { move: { x: 1, y: 0 } }, dt, open, config, { solids: [body] });
    expect(body.x - s.x).toBeCloseTo(r + body.r, 5);
    expect(s.y).toBeCloseTo(160, 5);
  });

  it('slides around a body hit off-centre instead of sticking', () => {
    let s: MovementState = { ...start, y: 165 };
    for (let i = 0; i < 40; i++) s = step(s, { move: { x: 1, y: 0 } }, dt, open, config, { solids: [body] });
    expect(s.x).toBeGreaterThan(body.x);
  });

  it('never pushes a player into a wall', () => {
    // Player against the left wall (interior starts at x = 32), body pressing from the right.
    const at = { x: 32 + r, y: 160 };
    const out = pushOutOfSolids(open.collision, at, { hw: r, hh: r }, r, [{ x: at.x + 5, y: 160, r: 10 }]);
    expect(out.x).toBeCloseTo(32 + r, 5);
  });

  it('changes nothing without bodies (the first map)', () => {
    expect(run(start, { x: 1, y: 0.3 }, 20)).toEqual(
      (() => {
        let s = start;
        for (let i = 0; i < 20; i++)
          s = step(s, { move: { x: 1, y: 0.3 } }, dt, open, config, { solids: [] });
        return s;
      })(),
    );
  });
});
