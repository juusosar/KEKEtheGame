import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import {
  crossesGateWrongWay,
  gateCooldownFrames,
  gateStopFrames,
  gateStopped,
  holdAtGates,
  passGates,
  NO_GATE_TIMERS,
  type Gate,
} from './gates';
import { applyInput } from './input';
import { knockbackStep } from './melee';
import { playerHalfSize, type MovementMap, type MovementState } from './movement';
import { findPath } from './pathfinding';
import { mapFrom } from './testGrid';

const config = loadConfig();
const half = playerHalfSize(config);

// A room split by a kiosk row (y = 4) with one one-tile lane at x = 4; its gate lets players go south.
const ROWS = [
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '####.####',
  '#.......#',
  '#.......#',
  '#.......#',
  '#########',
];
const LANE: Gate = { index: 0, x: 128, y: 128, width: 32, height: 32, dir: 's', kind: 'checkout' };
const LINE_Y = 144;
const withGates = (gates: readonly Gate[]): MovementMap => ({ ...mapFrom(ROWS), gates });
const map = withGates([LANE]);
const above: MovementState = { x: 144, y: 100, vx: 0, vy: 0 };
const below: MovementState = { x: 144, y: 190, vx: 0, vy: 0 };
const south = { move: { x: 0, y: 1 } };
const north = { move: { x: 0, y: -1 } };

function walk(
  s: MovementState,
  frame: { move: { x: number; y: number } },
  frames: number,
  m = map,
  carrying = false,
) {
  const trail: MovementState[] = [];
  for (let i = 0; i < frames; i++) {
    s = applyInput(s, frame, m, config, { carrying });
    trail.push(s);
  }
  return { end: s, trail };
}

describe('gate timers', () => {
  it('reads the stop and cooldown from config, in input frames', () => {
    expect(gateStopFrames('checkout', false, config)).toBe(
      Math.round(config.gateStopSeconds * config.inputHz),
    );
    expect(gateStopFrames('checkout', true, config)).toBe(
      Math.round(config.gateCarryStopSeconds * config.inputHz),
    );
    expect(gateStopFrames('checkout', true, config)).toBeGreaterThan(
      gateStopFrames('checkout', false, config),
    );
    expect(gateStopFrames('door', true, config)).toBe(0);
    expect(gateCooldownFrames(config)).toBe(Math.round(config.gateCooldownSeconds * config.inputHz));
    expect(gateStopped(undefined)).toBe(false);
    expect(gateStopped({ stop: 1, gate: 0, cooldown: 5 })).toBe(true);
  });
});

describe('passGates', () => {
  it('lets a body cross in the gate direction and stops it there', () => {
    const r = passGates(
      [LANE],
      { x: 144, y: 140 },
      { x: 144, y: 146, vx: 0, vy: 160 },
      half,
      NO_GATE_TIMERS,
      false,
      config,
    );
    expect(r).toMatchObject({ x: 144, y: 146, vx: 0, vy: 0, stoppedAt: LANE });
    expect(r.timers).toEqual({
      stop: gateStopFrames('checkout', false, config),
      gate: 0,
      cooldown: gateCooldownFrames(config),
    });
  });

  it('holds a body on the line when it tries the other way, like a wall', () => {
    const r = passGates(
      [LANE],
      { x: 144, y: 150 },
      { x: 144, y: 138, vx: 30, vy: -160 },
      half,
      NO_GATE_TIMERS,
      false,
      config,
    );
    expect(r).toMatchObject({ x: 144, y: LINE_Y, vx: 30, vy: 0 });
    expect(r.stoppedAt).toBeUndefined();
    expect(r.timers).toBe(NO_GATE_TIMERS);
  });

  it('ignores bodies that are not level with the gate', () => {
    const r = passGates(
      [LANE],
      { x: 60, y: 150 },
      { x: 60, y: 130, vx: 0, vy: -160 },
      half,
      NO_GATE_TIMERS,
      false,
      config,
    );
    expect(r).toMatchObject({ x: 60, y: 130, vy: -160 });
  });

  it('does not stop the same body twice at one gate within the cooldown, but another gate may', () => {
    const cooling = { stop: 0, gate: 0, cooldown: 10 };
    const again = passGates(
      [LANE],
      { x: 144, y: 140 },
      { x: 144, y: 146, vx: 0, vy: 160 },
      half,
      cooling,
      false,
      config,
    );
    expect(again.stoppedAt).toBeUndefined();
    expect(again).toMatchObject({ vy: 160, timers: cooling });
    const other = { ...LANE, index: 1 };
    const elsewhere = passGates(
      [LANE, other],
      { x: 144, y: 140 },
      { x: 144, y: 146, vx: 0, vy: 160 },
      half,
      cooling,
      false,
      config,
    );
    expect(elsewhere.stoppedAt).toBe(other);
  });

  it('never stops at a door', () => {
    const door: Gate = { ...LANE, kind: 'door' };
    const r = passGates(
      [door],
      { x: 144, y: 140 },
      { x: 144, y: 146, vx: 0, vy: 160 },
      half,
      NO_GATE_TIMERS,
      true,
      config,
    );
    expect(r.stoppedAt).toBeUndefined();
    expect(r).toMatchObject({ y: 146, vy: 160 });
    // ...but it is still one-way.
    expect(
      passGates(
        [door],
        { x: 144, y: 146 },
        { x: 144, y: 140, vx: 0, vy: -160 },
        half,
        NO_GATE_TIMERS,
        true,
        config,
      ).y,
    ).toBe(LINE_Y);
  });

  it('works on every axis', () => {
    const east: Gate = { index: 0, x: 0, y: 0, width: 32, height: 32, dir: 'e', kind: 'checkout' };
    expect(
      passGates([east], { x: 10, y: 16 }, { x: 20, y: 16, vx: 1, vy: 0 }, half, NO_GATE_TIMERS, false, config)
        .stoppedAt,
    ).toBe(east);
    expect(
      passGates(
        [east],
        { x: 20, y: 16 },
        { x: 10, y: 16, vx: -1, vy: 0 },
        half,
        NO_GATE_TIMERS,
        false,
        config,
      ).x,
    ).toBe(16);
    const west: Gate = { ...east, dir: 'w' };
    expect(
      passGates(
        [west],
        { x: 20, y: 16 },
        { x: 10, y: 16, vx: -1, vy: 0 },
        half,
        NO_GATE_TIMERS,
        false,
        config,
      ).stoppedAt,
    ).toBe(west);
    const n: Gate = { ...east, dir: 'n' };
    expect(
      passGates([n], { x: 16, y: 10 }, { x: 16, y: 20, vx: 0, vy: 1 }, half, NO_GATE_TIMERS, false, config).y,
    ).toBe(16);
  });
});

describe('applyInput with gates', () => {
  it('walks out through a gate, stands stopped, then goes on', () => {
    const { end, trail } = walk(above, south, 60);
    const stopAt = trail.findIndex((s) => gateStopped(s.gate));
    const frames = gateStopFrames('checkout', false, config);
    expect(stopAt).toBeGreaterThan(0);
    expect(trail[stopAt]?.y).toBeGreaterThanOrEqual(LINE_Y);
    // Stopped for exactly `frames` frames after the crossing frame, not moving.
    for (let i = stopAt + 1; i <= stopAt + frames; i++) {
      expect(trail[i]).toMatchObject({ x: trail[stopAt]?.x, y: trail[stopAt]?.y, vx: 0, vy: 0 });
    }
    expect(trail[stopAt + frames]?.gate?.stop).toBe(0);
    expect((trail[stopAt + frames + 1]?.y ?? 0) > (trail[stopAt]?.y ?? 0)).toBe(true);
    expect(end.y).toBeGreaterThan(LINE_Y + 32);
  });

  it('cannot walk back in', () => {
    const { end, trail } = walk(below, north, 60);
    expect(end.y).toBe(LINE_Y);
    expect(trail.every((s) => s.y >= LINE_Y && !gateStopped(s.gate))).toBe(true);
  });

  it('stops a carrier longer than an empty-handed player', () => {
    const count = (carrying: boolean) =>
      walk(above, south, 90, map, carrying).trail.filter((s) => gateStopped(s.gate)).length;
    const empty = count(false);
    const carried = count(true);
    expect(empty).toBe(gateStopFrames('checkout', false, config));
    expect(carried).toBe(gateStopFrames('checkout', true, config));
  });

  it('counts the cooldown down every frame, stopped or not', () => {
    const { trail } = walk(above, south, 200);
    const stopAt = trail.findIndex((s) => gateStopped(s.gate));
    const cd = gateCooldownFrames(config);
    expect(trail[stopAt]?.gate?.cooldown).toBe(cd);
    expect(trail[stopAt + 10]?.gate?.cooldown).toBe(cd - 10);
    expect(trail[trail.length - 1]?.gate).toEqual({
      stop: 0,
      gate: 0,
      cooldown: Math.max(0, cd - (199 - stopAt)),
    });
  });

  it('a body pushed back over the line within the cooldown is not stopped again', () => {
    const { trail } = walk(above, south, 40);
    const after = trail[trail.length - 1] as MovementState; // through and past the stop
    const pushedBack: MovementState = { ...after, y: LINE_Y - 4 };
    const again = walk(pushedBack, south, 10).trail;
    expect(again.some((s) => gateStopped(s.gate))).toBe(false);
  });

  it('leaves maps without gates exactly as before (no timers added)', () => {
    const plain = mapFrom(ROWS);
    const s = applyInput(above, south, plain, config);
    expect(s.gate).toBeUndefined();
  });
});

describe('server-moved bodies', () => {
  it('a shove never pushes a body back in through a gate', () => {
    const shove = { dir: { x: 0, y: -1 }, remainingPx: 64, speedPxPerSecond: 640 };
    const r = knockbackStep(mapFrom(ROWS).collision, { x: 144, y: 160 }, half, shove, 0.1, [LANE]);
    expect(r.pos.y).toBe(LINE_Y);
    expect(holdAtGates(undefined, { x: 0, y: 0 }, { x: 5, y: 5 }, half)).toEqual({ x: 5, y: 5 });
  });
});

describe('pathfinding through gates', () => {
  it('knows when a straight walk goes the wrong way', () => {
    expect(crossesGateWrongWay([LANE], { x: 144, y: 176 }, { x: 144, y: 112 }, half)).toBe(true);
    expect(crossesGateWrongWay([LANE], { x: 144, y: 112 }, { x: 144, y: 176 }, half)).toBe(false);
    expect(crossesGateWrongWay([LANE], { x: 40, y: 176 }, { x: 40, y: 112 }, half)).toBe(false);
  });

  it('finds no path back in, and the way out', () => {
    const grid = mapFrom(ROWS).collision;
    const refuses = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      crossesGateWrongWay([LANE], a, b, half);
    expect(findPath(grid, { x: 144, y: 208 }, { x: 144, y: 80 }, { refuses })).toBeNull();
    expect(findPath(grid, { x: 144, y: 80 }, { x: 144, y: 208 }, { refuses })).not.toBeNull();
    expect(findPath(grid, { x: 144, y: 208 }, { x: 144, y: 80 })).not.toBeNull();
  });
});
