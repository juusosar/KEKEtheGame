// Pushable shopping carts (Phase 2 decision 12; P2-5). A cart is an axis-aligned box that rolls on the
// floor: a player walking into it pushes it at `cartPushSpeedMultiplier` × their speed, a released cart
// rolls on and slows by `cartFriction` per server tick, and a pallet jack dash shoves it about
// `cartShoveTiles`. Carts stop at walls, other carts and other bodies; they block players, and lines of
// sight (projectiles, splashes, swings, guard sight) through `CollisionGrid.segmentBlockedAt`.
// Pure and deterministic like the rest of rules/: the server runs it every input frame and tick, the
// client's prediction replays the same pushes on its own copy of the carts.
import type { GameConfig } from '../config';
import type { Vec2 } from '../types';
import { moveAabb, type CollisionGrid, type HalfSize } from './collision';
import type { MovementState } from './movement';

/** The way a cart's nose points: the way it last rolled. Matches the art frames `cart_<dir>`. */
export type CartDir = 'down' | 'up' | 'left' | 'right';
export const CART_DIRS: readonly CartDir[] = ['down', 'up', 'left', 'right'];

/** A cart's body. Mutable: the push and roll rules move carts in place. */
export interface CartBody {
  readonly id: number;
  /** Centre, pixels. */
  x: number;
  y: number;
  /** Rolling velocity, pixels per second. */
  vx: number;
  vy: number;
  dir: CartDir;
  /** Round seconds of the last push; a cart being pushed does not roll on its own until the grace is over. */
  pushedAt: number;
}

/** Another body a cart stops at (a player who is not the pusher). Centre and half extents. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly hw: number;
  readonly hh: number;
}

/** Everything the cart rules move against. */
export interface CartWorld {
  /** Walls (the live map grid, with parked stock carts). */
  readonly grid: CollisionGrid;
  /** Every cart in the round, in id order. Moved in place. */
  readonly carts: CartBody[];
  /** Bodies carts stop at, other than the one pushing. */
  readonly obstacles: readonly Box[];
}

export type CartConfig = Pick<
  GameConfig,
  | 'cartSizePx'
  | 'cartPushSpeedMultiplier'
  | 'cartFriction'
  | 'cartPushGraceSeconds'
  | 'cartShoveTiles'
  | 'serverTickHz'
  | 'tileSize'
>;

/** Rolling speeds below this (px/s) stop the cart. Not a tunable. */
const CART_REST_SPEED = 1;
/** Float slack for "already touching" comparisons. */
const EPS = 1e-6;

/** Half extents of a cart body. */
export function cartHalfSize(config: Pick<GameConfig, 'cartSizePx'>): HalfSize {
  const h = config.cartSizePx / 2;
  return { hw: h, hh: h };
}

/** A cart at rest at `at`, nose pointing `dir`. */
export function newCart(id: number, at: Vec2, dir: CartDir = 'left'): CartBody {
  return { id, x: at.x, y: at.y, vx: 0, vy: 0, dir, pushedAt: -Infinity };
}

/** The way a cart moving by (dx, dy) points: the larger axis wins, ties go to x. */
export function cartDirFor(dx: number, dy: number, fallback: CartDir): CartDir {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

type Axis = 'x' | 'y';
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const halfOn = (half: HalfSize, axis: Axis): number => (axis === 'x' ? half.hw : half.hh);

/** True when the open intervals (a ± ah) and (b ± bh) overlap: touching is not overlapping. */
function spansOverlap(a: number, ah: number, b: number, bh: number): boolean {
  return Math.abs(a - b) < ah + bh - EPS;
}

/** True when two boxes overlap (touching does not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return spansOverlap(a.x, a.hw, b.x, b.hw) && spansOverlap(a.y, a.hh, b.y, b.hh);
}

function cartBox(cart: CartBody, half: HalfSize): Box {
  return { x: cart.x, y: cart.y, hw: half.hw, hh: half.hh };
}

/**
 * Moves `cart` by `d` pixels along `axis`, stopping flush at walls, other carts and `world.obstacles`.
 * Something it already overlaps does not stop it (so bodies can always come apart). Returns the signed
 * distance it moved.
 */
function moveCartAxis(world: CartWorld, cart: CartBody, axis: Axis, d: number, half: HalfSize): number {
  if (d === 0) return 0;
  const start = cart[axis];
  const moved = moveAabb(world.grid, cart, half, axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d });
  let target = moved[axis];
  const h = halfOn(half, axis);
  const oh = halfOn(half, other(axis));
  const blockers: Box[] = [
    ...world.carts.filter((c) => c !== cart).map((c) => cartBox(c, half)),
    ...world.obstacles,
  ];
  for (const b of blockers) {
    const bc = axis === 'x' ? b.x : b.y;
    const bh = axis === 'x' ? b.hw : b.hh;
    const boc = axis === 'x' ? b.y : b.x;
    const boh = axis === 'x' ? b.hh : b.hw;
    if (!spansOverlap(cart[other(axis)], oh, boc, boh)) continue;
    if (d > 0 && bc - bh >= start + h - EPS) target = Math.min(target, bc - bh - h);
    if (d < 0 && bc + bh <= start - h + EPS) target = Math.max(target, bc + bh + h);
  }
  if (d > 0) target = Math.max(start, target);
  else target = Math.min(start, target);
  cart[axis] = target;
  return target - start;
}

/** Context of one player's push. */
export interface PushContext {
  readonly world: CartWorld;
  /** The pusher's half size. */
  readonly half: HalfSize;
  /** Length of the input frame, seconds (sets the pushed cart's rolling speed). */
  readonly dt: number;
  /** Round seconds now (`CartBody.pushedAt`). */
  readonly now: number;
  readonly config: CartConfig;
}

/** What one frame of pushing did. */
export interface PushResult {
  /** The player after carts stopped or slowed them. */
  readonly state: MovementState;
  /** Ids of the carts this frame moved. */
  readonly pushed: readonly number[];
}

/**
 * Resolves one player movement step `prev` → `next` (already through the walls) against the carts.
 * Axis by axis (x, then y): a cart the player walks into is pushed along that axis and the player slows
 * to `cartPushSpeedMultiplier` on it; the player stops flush at a cart that cannot move (wall, other
 * cart, other body). A cart the player already overlaps never blocks them, so nobody gets stuck.
 */
export function pushCarts(prev: MovementState, next: MovementState, ctx: PushContext): PushResult {
  const { world, half, config } = ctx;
  const cartHalf = cartHalfSize(config);
  const pushed = new Set<number>();
  const pos = { x: prev.x, y: prev.y };
  const vel = { x: next.vx, y: next.vy };

  for (const axis of ['x', 'y'] as const) {
    const d = next[axis] - prev[axis];
    if (d === 0) {
      pos[axis] = next[axis];
      continue;
    }
    const o = other(axis);
    const h = halfOn(half, axis);
    const ch = halfOn(cartHalf, axis);
    const ahead = (cart: CartBody): boolean => {
      if (!spansOverlap(pos[o], halfOn(half, o), cart[o], halfOn(cartHalf, o))) return false;
      // Already overlapping on this axis: walk out freely.
      if (spansOverlap(pos[axis], h, cart[axis], ch)) return false;
      const gap = d > 0 ? cart[axis] - ch - (pos[axis] + h) : pos[axis] - h - (cart[axis] + ch);
      return gap >= -EPS && gap < Math.abs(d) - EPS;
    };
    const contacts = world.carts.filter(ahead);
    if (contacts.length === 0) {
      pos[axis] = next[axis];
      continue;
    }
    const want = pos[axis] + d * config.cartPushSpeedMultiplier;
    let result = want;
    for (const cart of contacts) {
      // How far the cart must go for the player to reach `want` flush against it.
      const need = d > 0 ? want + h + ch - cart[axis] : want - h - ch - cart[axis];
      if ((d > 0 && need > 0) || (d < 0 && need < 0)) {
        const moved = moveCartAxis(world, cart, axis, need, cartHalf);
        if (moved !== 0) {
          pushed.add(cart.id);
          cart.pushedAt = ctx.now;
          cart.dir = cartDirFor(axis === 'x' ? moved : 0, axis === 'y' ? moved : 0, cart.dir);
          if (axis === 'x') {
            cart.vx = moved / ctx.dt;
            cart.vy = 0;
          } else {
            cart.vy = moved / ctx.dt;
            cart.vx = 0;
          }
        }
      }
      const flush = d > 0 ? cart[axis] - ch - h : cart[axis] + ch + h;
      result = d > 0 ? Math.min(result, flush) : Math.max(result, flush);
    }
    // Never backwards.
    result = d > 0 ? Math.max(pos[axis], result) : Math.min(pos[axis], result);
    const blocked = Math.abs(result - want) > EPS;
    pos[axis] = result;
    vel[axis] = blocked ? 0 : vel[axis] * config.cartPushSpeedMultiplier;
  }
  return {
    state: { x: pos.x, y: pos.y, vx: vel.x, vy: vel.y },
    pushed: [...pushed].sort((a, b) => a - b),
  };
}

/**
 * One server tick of rolling: every cart that is not being pushed (no push within `cartPushGraceSeconds`)
 * rolls on with its velocity, stops at walls, carts and bodies, and keeps `cartFriction` of its speed per
 * tick. Returns the ids of the carts that moved.
 */
export function rollCarts(world: CartWorld, dt: number, now: number, config: CartConfig): number[] {
  if (!(dt > 0)) return [];
  const half = cartHalfSize(config);
  const retain = Math.pow(Math.min(Math.max(config.cartFriction, 0), 1), dt * config.serverTickHz);
  const moved: number[] = [];
  for (const cart of world.carts) {
    if (cart.vx === 0 && cart.vy === 0) continue;
    if (now - cart.pushedAt < config.cartPushGraceSeconds) continue;
    const wantX = cart.vx * dt;
    const wantY = cart.vy * dt;
    const mx = moveCartAxis(world, cart, 'x', wantX, half);
    const my = moveCartAxis(world, cart, 'y', wantY, half);
    if (mx !== 0 || my !== 0) {
      moved.push(cart.id);
      cart.dir = cartDirFor(mx, my, cart.dir);
    }
    cart.vx = Math.abs(mx - wantX) > EPS ? 0 : cart.vx * retain;
    cart.vy = Math.abs(my - wantY) > EPS ? 0 : cart.vy * retain;
    if (Math.hypot(cart.vx, cart.vy) < CART_REST_SPEED) {
      cart.vx = 0;
      cart.vy = 0;
    }
  }
  return moved;
}

/**
 * The starting speed (px/s) that rolls a cart `cartShoveTiles` tiles on open floor: the rolling distance
 * is v · dt / (1 − friction) for ticks of dt = 1 / serverTickHz.
 */
export function shoveSpeed(config: CartConfig): number {
  const f = Math.min(Math.max(config.cartFriction, 0), 0.999);
  return config.cartShoveTiles * config.tileSize * (1 - f) * config.serverTickHz;
}

/** A pallet jack dash shoves `cart` along the unit vector `dir`: it rolls at once, no push grace. */
export function shoveCart(cart: CartBody, dir: Vec2, config: CartConfig): void {
  const len = Math.hypot(dir.x, dir.y);
  if (!(len > 0)) return;
  const v = shoveSpeed(config);
  cart.vx = (dir.x / len) * v;
  cart.vy = (dir.y / len) * v;
  cart.pushedAt = -Infinity;
  cart.dir = cartDirFor(cart.vx, cart.vy, cart.dir);
}

/**
 * Fraction t in [0, 1] at which the segment `from` → `from + delta` first enters `box` (0 when it starts
 * inside), or null when it misses. Slab method; touching an edge counts as a miss.
 */
export function segmentBoxTime(from: Vec2, delta: Vec2, box: Box): number | null {
  let t0 = 0;
  let t1 = 1;
  for (const axis of ['x', 'y'] as const) {
    const p = from[axis];
    const d = delta[axis];
    const lo = box[axis] - (axis === 'x' ? box.hw : box.hh);
    const hi = box[axis] + (axis === 'x' ? box.hw : box.hh);
    if (Math.abs(d) < 1e-12) {
      if (p <= lo || p >= hi) return null;
      continue;
    }
    let a = (lo - p) / d;
    let b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 >= t1) return null;
  }
  return t0;
}

/**
 * The earliest t at which the segment enters any cart, or null. Plug it into a grid as
 * `segmentBlockedAt` (see `withCartSight`) so lines of sight and projectiles stop at carts.
 */
export function cartsSegmentTime(
  carts: readonly CartBody[],
  from: Vec2,
  delta: Vec2,
  config: Pick<GameConfig, 'cartSizePx'>,
): number | null {
  const half = cartHalfSize(config);
  let best: number | null = null;
  for (const cart of carts) {
    const t = segmentBoxTime(from, delta, cartBox(cart, half));
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * A view of `grid` whose lines of sight stop at what `segmentBlockedAt` reports (the carts). Movement
 * (`isSolid`) is unchanged; `clearLine` and projectile wall checks read the hook.
 */
export function withSegmentBlocker<G extends CollisionGrid>(
  grid: G,
  segmentBlockedAt: (from: Vec2, delta: Vec2) => number | null,
): G {
  return Object.assign(Object.create(Object.getPrototypeOf(grid) as object) as G, grid, { segmentBlockedAt });
}
