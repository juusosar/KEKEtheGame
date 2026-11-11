import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { clearLine } from './collision';
import {
  cartDirFor,
  cartsSegmentTime,
  newCart,
  pushCarts,
  rollCarts,
  segmentBoxTime,
  shoveCart,
  shoveSpeed,
  withSegmentBlocker,
  type CartBody,
  type CartWorld,
  type PushContext,
} from './carts';
import { applyInput } from './input';
import { playerHalfSize, type MovementState } from './movement';
import { stepProjectile } from './projectile';
import { gridFrom, mapFrom } from './testGrid';

const config = loadConfig();
const half = playerHalfSize(config); // 10 × 10
const CART = config.cartSizePx / 2; // 12
const dt = 1 / config.inputHz;
// 20 tiles wide, 5 tall, open floor inside a wall ring.
const rows = ['####################', ...Array(3).fill('#..................#'), '####################'];
const grid = gridFrom(rows);
const map = mapFrom(rows);

function world(carts: CartBody[], obstacles: CartWorld['obstacles'] = []): CartWorld {
  return { grid, carts, obstacles };
}

function ctx(w: CartWorld, now = 0): PushContext {
  return { world: w, half, dt, now, config };
}

/** One input frame of walking `move`, resolved against the carts. */
function walk(state: MovementState, move: { x: number; y: number }, w: CartWorld, now = 0): MovementState {
  const next = applyInput(state, { move }, map, config);
  return pushCarts(state, next, ctx(w, now)).state;
}

const at = (x: number, y: number): MovementState => ({ x, y, vx: 0, vy: 0 });

describe('carts: pushing', () => {
  it('a player walking into a cart pushes it at cartPushSpeedMultiplier of their speed', () => {
    const cart = newCart(1, { x: 200, y: 80 });
    const w = world([cart]);
    // Flush against the cart's west side.
    let p = at(200 - CART - half.hw, 80);
    const step = config.playerSpeed * dt;
    p = walk(p, { x: 1, y: 0 }, w);
    expect(p.x).toBeCloseTo(200 - CART - half.hw + step * config.cartPushSpeedMultiplier, 6);
    expect(cart.x).toBeCloseTo(200 + step * config.cartPushSpeedMultiplier, 6);
    expect(cart.y).toBe(80);
    expect(cart.dir).toBe('right');
    expect(cart.vx).toBeCloseTo(config.playerSpeed * config.cartPushSpeedMultiplier, 6);
    // Ten more frames: the pair keeps moving together, flush.
    for (let i = 0; i < 10; i++) p = walk(p, { x: 1, y: 0 }, w);
    expect(cart.x - CART - half.hw).toBeCloseTo(p.x, 6);
  });

  it('walking past a cart without touching it does not push it', () => {
    const cart = newCart(1, { x: 200, y: 80 });
    const w = world([cart]);
    let p = at(150, 80 + CART + half.hh); // just below it, touching edges only
    for (let i = 0; i < 20; i++) p = walk(p, { x: 1, y: 0 }, w);
    expect(cart.x).toBe(200);
    expect(p.x).toBeCloseTo(150 + 20 * config.playerSpeed * dt, 6);
  });

  it('a cart stops at a wall and the player stops flush behind it', () => {
    // East wall is the tile column x = 19 (pixels 608+).
    const cart = newCart(1, { x: 560, y: 80 });
    const w = world([cart]);
    let p = at(560 - CART - half.hw, 80);
    for (let i = 0; i < 60; i++) p = walk(p, { x: 1, y: 0 }, w);
    expect(cart.x).toBeCloseTo(608 - CART, 6);
    expect(p.x).toBeCloseTo(608 - 2 * CART - half.hw, 6);
    expect(p.vx).toBe(0);
  });

  it('a cart stops at another cart (no chain pushing)', () => {
    const a = newCart(1, { x: 200, y: 80 });
    const b = newCart(2, { x: 200 + 2 * CART + 10, y: 80 });
    const w = world([a, b]);
    let p = at(200 - CART - half.hw, 80);
    for (let i = 0; i < 30; i++) p = walk(p, { x: 1, y: 0 }, w);
    expect(a.x).toBeCloseTo(b.x - 2 * CART, 6);
    expect(b.x).toBe(200 + 2 * CART + 10);
    expect(p.x).toBeCloseTo(a.x - CART - half.hw, 6);
  });

  it('a cart stops at another body', () => {
    const cart = newCart(1, { x: 200, y: 80 });
    const other = { x: 260, y: 80, hw: half.hw, hh: half.hh };
    const w = world([cart], [other]);
    let p = at(200 - CART - half.hw, 80);
    for (let i = 0; i < 30; i++) p = walk(p, { x: 1, y: 0 }, w);
    expect(cart.x).toBeCloseTo(260 - half.hw - CART, 6);
  });

  it('pushes along y too, and diagonally only along the axis that touches', () => {
    const cart = newCart(1, { x: 200, y: 60 });
    const w = world([cart]);
    let p = at(200, 60 + CART + half.hh); // below it
    p = walk(p, { x: 0, y: -1 }, w);
    expect(cart.y).toBeLessThan(60);
    expect(cart.dir).toBe('up');
    const x0 = cart.x;
    p = walk(p, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, w);
    expect(cart.x).toBe(x0);
    expect(p.x).toBeGreaterThan(200);
  });

  it('a player already overlapping a cart can walk out of it', () => {
    const cart = newCart(1, { x: 200, y: 80 });
    const w = world([cart]);
    let p = at(195, 80);
    for (let i = 0; i < 10; i++) p = walk(p, { x: -1, y: 0 }, w);
    expect(p.x).toBeCloseTo(195 - 10 * config.playerSpeed * dt, 6);
    expect(cart.x).toBe(200);
  });

  it('reports which carts moved', () => {
    const cart = newCart(7, { x: 200, y: 80 });
    const w = world([cart]);
    const p = at(200 - CART - half.hw, 80);
    const next = applyInput(p, { move: { x: 1, y: 0 } }, map, config);
    expect(pushCarts(p, next, ctx(w)).pushed).toEqual([7]);
    const still = applyInput(p, { move: { x: -1, y: 0 } }, map, config);
    expect(pushCarts(p, still, ctx(w)).pushed).toEqual([]);
  });

  it('is deterministic: the same pushes give the same carts', () => {
    const run = (): CartBody[] => {
      const carts = [newCart(1, { x: 200, y: 80 }), newCart(2, { x: 300, y: 90 })];
      const w = world(carts);
      let p = at(150, 80);
      for (let i = 0; i < 90; i++) p = walk(p, { x: 1, y: i % 3 === 0 ? 0.3 : 0 }, w, i * dt);
      return carts;
    };
    expect(run()).toEqual(run());
  });
});

describe('carts: rolling', () => {
  it('a released cart rolls on after the push grace and slows to a stop', () => {
    const cart = newCart(1, { x: 200, y: 80 });
    cart.vx = 112;
    cart.pushedAt = 0;
    const w = world([cart]);
    const tick = 1 / config.serverTickHz;
    // Inside the grace: held.
    expect(rollCarts(w, tick, config.cartPushGraceSeconds / 2, config)).toEqual([]);
    expect(cart.x).toBe(200);
    let now = config.cartPushGraceSeconds;
    let rolled = 0;
    for (let i = 0; i < 100; i++) {
      if (rollCarts(w, tick, now, config).length > 0) rolled++;
      now += tick;
    }
    expect(rolled).toBeGreaterThan(3);
    expect(cart.vx).toBe(0);
    const expected = (112 * tick) / (1 - config.cartFriction);
    expect(cart.x - 200).toBeGreaterThan(expected * 0.9);
    expect(cart.x - 200).toBeLessThan(expected * 1.01);
  });

  it('a rolling cart stops at a wall, a cart and a body', () => {
    const tick = 1 / config.serverTickHz;
    const wall = newCart(1, { x: 560, y: 48 });
    wall.vx = 600;
    const a = newCart(2, { x: 100, y: 80 });
    a.vx = 600;
    const b = newCart(3, { x: 160, y: 80 });
    const c = newCart(4, { x: 300, y: 112 });
    c.vx = 600;
    const body = { x: 340, y: 112, hw: half.hw, hh: half.hh };
    const w = world([wall, a, b, c], [body]);
    for (let i = 0; i < 20; i++) rollCarts(w, tick, 10 + i * tick, config);
    expect(wall.x).toBeCloseTo(608 - CART, 6);
    expect(a.x).toBeCloseTo(160 - 2 * CART, 6);
    expect(b.x).toBe(160);
    expect(c.x).toBeCloseTo(340 - half.hw - CART, 6);
    for (const cart of [wall, a, c]) expect(cart.vx).toBe(0);
  });
});

describe('carts: pallet jack shove', () => {
  it('rolls about cartShoveTiles tiles on open floor', () => {
    const wide = gridFrom(['#'.repeat(40), '#' + '.'.repeat(38) + '#', '#'.repeat(40)]);
    const cart = newCart(1, { x: 100, y: 48 });
    const w: CartWorld = { grid: wide, carts: [cart], obstacles: [] };
    shoveCart(cart, { x: 2, y: 0 }, config);
    expect(cart.vx).toBeCloseTo(shoveSpeed(config), 6);
    expect(cart.dir).toBe('right');
    const tick = 1 / config.serverTickHz;
    for (let i = 0; i < 200; i++) rollCarts(w, tick, i * tick, config);
    const tiles = (cart.x - 100) / config.tileSize;
    expect(tiles).toBeGreaterThan(config.cartShoveTiles * 0.95);
    expect(tiles).toBeLessThanOrEqual(config.cartShoveTiles + 1e-6);
  });

  it('ignores a zero direction', () => {
    const cart = newCart(1, { x: 100, y: 48 });
    shoveCart(cart, { x: 0, y: 0 }, config);
    expect(cart.vx).toBe(0);
    expect(cart.vy).toBe(0);
  });
});

describe('carts: lines of sight and projectiles', () => {
  it('segmentBoxTime finds the entry point, misses and starts inside', () => {
    const box = { x: 100, y: 100, hw: 10, hh: 10 };
    expect(segmentBoxTime({ x: 0, y: 100 }, { x: 200, y: 0 }, box)).toBeCloseTo(0.45, 6);
    expect(segmentBoxTime({ x: 0, y: 50 }, { x: 200, y: 0 }, box)).toBeNull();
    expect(segmentBoxTime({ x: 0, y: 100 }, { x: 50, y: 0 }, box)).toBeNull();
    expect(segmentBoxTime({ x: 100, y: 100 }, { x: 50, y: 0 }, box)).toBe(0);
    // Grazing an edge is a miss.
    expect(segmentBoxTime({ x: 0, y: 110 }, { x: 200, y: 0 }, box)).toBeNull();
  });

  it('a cart blocks clearLine; the bare grid does not', () => {
    const carts = [newCart(1, { x: 300, y: 80 })];
    const sight = withSegmentBlocker(grid, (from, delta) => cartsSegmentTime(carts, from, delta, config));
    expect(clearLine(grid, { x: 100, y: 80 }, { x: 500, y: 80 })).toBe(true);
    expect(clearLine(sight, { x: 100, y: 80 }, { x: 500, y: 80 })).toBe(false);
    expect(clearLine(sight, { x: 100, y: 40 }, { x: 500, y: 40 })).toBe(true);
    // The wrapped grid keeps the walls.
    expect(sight.isSolid(0, 0)).toBe(true);
    expect(sight.width).toBe(grid.width);
  });

  it('a projectile stops at a cart before a body behind it', () => {
    const carts = [newCart(1, { x: 300, y: 80 })];
    const sight = withSegmentBlocker(grid, (from, delta) => cartsSegmentTime(carts, from, delta, config));
    const flight = {
      x: 100,
      y: 80,
      dir: { x: 1, y: 0 },
      speedPxPerSecond: 1000,
      rangePx: 1000,
      travelledPx: 0,
      radiusPx: 4,
    };
    const behind = [{ id: 'b', x: 400, y: 80 }];
    const hit = stepProjectile(sight, flight, 0.5, behind, 10);
    expect(hit.impact).toEqual({ kind: 'wall' });
    expect(hit.flight.x).toBeCloseTo(300 - CART, 6);
    // Without the cart it reaches the body.
    expect(stepProjectile(grid, flight, 0.5, behind, 10).impact).toEqual({ kind: 'body', id: 'b' });
  });
});

describe('carts: helpers', () => {
  it('cartDirFor picks the larger axis and keeps the old dir at rest', () => {
    expect(cartDirFor(3, 1, 'up')).toBe('right');
    expect(cartDirFor(-3, 1, 'up')).toBe('left');
    expect(cartDirFor(1, 3, 'left')).toBe('down');
    expect(cartDirFor(1, -3, 'left')).toBe('up');
    expect(cartDirFor(0, 0, 'up')).toBe('up');
  });
});
