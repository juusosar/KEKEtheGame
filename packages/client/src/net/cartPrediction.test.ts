// Cart pushing in client prediction (P2-5): the predictor pushes its own copy of the server's carts with the
// same shared rules, so a push replays exactly what the server ran and needs no correction.
import {
  applyInput,
  loadConfig,
  newCart,
  playerHalfSize,
  pushCarts,
  type CartBody,
  type InputFrame,
  type MovementMap,
} from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { cartBodies, readCarts } from './cartView';
import { Predictor } from './prediction';

const config = loadConfig();
const half = playerHalfSize(config);
const CART = config.cartSizePx / 2;
const rows = [
  '####################',
  ...Array.from({ length: 8 }, () => '#..................#'),
  '####################',
];
const map: MovementMap = {
  collision: { width: 20, height: 10, tileSize: 32, isSolid: (tx, ty) => rows[ty]?.[tx] === '#' },
  zoneAt: () => undefined,
};
const frame = (seq: number, x: number): InputFrame => ({ seq, move: { x, y: 0 }, aim: 0, buttons: 0 });

/** The server: the same frames through applyInput + pushCarts on its own carts. */
function server(from: { x: number; y: number }, carts: CartBody[], frames: InputFrame[]) {
  let s = { ...from, vx: 0, vy: 0 };
  for (const f of frames) {
    const next = applyInput(s, f, map, config);
    s = {
      ...pushCarts(s, next, {
        world: { grid: map.collision, carts, obstacles: [] },
        half,
        dt: 1 / config.inputHz,
        now: 0,
        config,
      }).state,
    };
  }
  return s;
}

describe('Predictor with carts', () => {
  const startX = 200 - CART - half.hw;

  it('pushes its copy of the carts and agrees with the server on reconcile', () => {
    const p = new Predictor(map, config, { x: startX, y: 80, vx: 0, vy: 0 });
    p.useCarts(config);
    p.setCarts([newCart(1, { x: 200, y: 80 })]);
    p.reset({ x: startX, y: 80, vx: 0, vy: 0 });
    const frames = [1, 2, 3, 4, 5, 6].map((seq) => frame(seq, 1));
    for (const f of frames) p.apply(f);
    expect(p.predictedCarts[0]?.x ?? 0).toBeGreaterThan(200);
    const predicted = p.state;

    // The server ran the first 3 frames: its body and carts arrive, the other 3 replay on top.
    const serverCarts = [newCart(1, { x: 200, y: 80 })];
    const body = server({ x: startX, y: 80 }, serverCarts, frames.slice(0, 3));
    p.setCarts(serverCarts);
    p.reconcile({ ...body, ack: 3 });
    expect(p.lastCorrection).toBe(0);
    expect(p.state.x).toBeCloseTo(predicted.x, 9);
    // Pushing slows the player: less than six full-speed frames.
    expect(p.state.x - startX).toBeLessThan(6 * (config.playerSpeed / config.inputHz));
  });

  it('without useCarts the carts are ignored (old behaviour)', () => {
    const p = new Predictor(map, config, { x: startX, y: 80, vx: 0, vy: 0 });
    p.setCarts([newCart(1, { x: 200, y: 80 })]);
    p.apply(frame(1, 1));
    expect(p.state.x).toBeCloseTo(startX + config.playerSpeed / config.inputHz, 9);
  });

  it('readCarts reads the synced carts defensively, sorted by id', () => {
    const state = {
      carts: new Map<string, unknown>([
        ['2', { id: 2, x: 10, y: 20, dir: 'up' }],
        ['1', { id: 1, x: 1, y: 2, dir: 'sideways' }],
        ['x', 'junk'],
      ]),
    };
    expect(readCarts(state)).toEqual([
      { id: 1, x: 1, y: 2, dir: 'left' },
      { id: 2, x: 10, y: 20, dir: 'up' },
    ]);
    expect(readCarts(null)).toEqual([]);
    expect(cartBodies(readCarts(state))[1]).toMatchObject({ id: 2, x: 10, y: 20, vx: 0, vy: 0, dir: 'up' });
  });
});
