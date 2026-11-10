// Player movement rules (§3.2, §6, §9.1, §15.3). Shared by the server simulation and client prediction,
// so it must stay pure and deterministic: same state + input + dt + map gives the same result everywhere.
import type { GameConfig } from '../config';
import type { InputFrame, Vec2 } from '../types';
import { moveAabb, type CollisionGrid, type HalfSize } from './collision';

/** Floor properties of a map zone. `Zone` from shared/src/map satisfies this shape. */
export interface FloorZone {
  /** Fraction of velocity retained per server tick (0 = instant stop, 0.92 = icy). Unset = normal floor. */
  readonly friction?: number | undefined;
  /** Multiplier on top speed while standing in the zone. Unset = 1. */
  readonly speedMultiplier?: number | undefined;
}

/** What movement needs from a map. `MapModel` from shared/src/map satisfies this shape. */
export interface MovementMap {
  readonly collision: CollisionGrid;
  /** Zone at a pixel position, or undefined outside every zone. */
  zoneAt(x: number, y: number): FloorZone | undefined;
}

/** Position (pixels, centre of the body) and velocity (pixels per second) of a moving body. */
export interface MovementState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** The config keys movement reads. A full `GameConfig` works. */
export type MovementConfig = Pick<GameConfig, 'playerSpeed' | 'playerHitboxSize' | 'serverTickHz'>;

/** Per-player multipliers that change over time, e.g. carrying (§3.2). Later: ketchup slow, pan block. */
export interface StepModifiers {
  /** Multiplies top speed. Defaults to 1. */
  readonly speedMultiplier?: number;
}

/** Velocities below this (px/s) snap to zero so a slide ends instead of decaying forever. Not a tunable. */
const REST_SPEED = 0.01;

/** Speed multiplier for a carrier (§3.2): `carrySpeedMultiplier` when carrying an item or order box, else 1. */
export function carryMultiplier(config: Pick<GameConfig, 'carrySpeedMultiplier'>, carrying: boolean): number {
  return carrying ? config.carrySpeedMultiplier : 1;
}

/** Clamps a move vector to length 1, so diagonals are not faster than straight lines. */
export function normalizeMove(move: Vec2): Vec2 {
  const x = Number.isFinite(move.x) ? move.x : 0;
  const y = Number.isFinite(move.y) ? move.y : 0;
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

/** The player's axis-aligned body, centred on its position. */
export function playerHalfSize(config: Pick<GameConfig, 'playerHitboxSize'>): HalfSize {
  const h = config.playerHitboxSize / 2;
  return { hw: h, hh: h };
}

/**
 * Advances one body by `dt` seconds.
 *
 * - Desired velocity = normalised `input.move` × `playerSpeed` × zone `speedMultiplier` × `modifiers.speedMultiplier`.
 * - On a normal floor the body reaches the desired velocity at once.
 * - In a zone with `friction` f, the body keeps f of its velocity per server tick and blends towards the
 *   desired velocity with the rest, so it keeps sliding when input stops. The per-tick factor is scaled
 *   to `dt` (f ^ (dt × serverTickHz)), so client frames and server ticks agree.
 * - The body then moves through the collision grid with wall sliding; the velocity component into a wall is zeroed.
 *
 * The zone is sampled at the position before the move.
 */
export function step(
  state: MovementState,
  input: Pick<InputFrame, 'move'>,
  dt: number,
  map: MovementMap,
  config: MovementConfig,
  modifiers: StepModifiers = {},
): MovementState {
  if (!(dt > 0)) return state;

  const zone = map.zoneAt(state.x, state.y);
  const move = normalizeMove(input.move);
  const speed = config.playerSpeed * (zone?.speedMultiplier ?? 1) * (modifiers.speedMultiplier ?? 1);
  const targetVx = move.x * speed;
  const targetVy = move.y * speed;

  let vx = targetVx;
  let vy = targetVy;
  const friction = zone?.friction;
  if (friction !== undefined && friction > 0) {
    const retain = Math.pow(Math.min(friction, 1), dt * config.serverTickHz);
    vx = state.vx * retain + targetVx * (1 - retain);
    vy = state.vy * retain + targetVy * (1 - retain);
  }
  if (Math.abs(vx) < REST_SPEED) vx = 0;
  if (Math.abs(vy) < REST_SPEED) vy = 0;

  const moved = moveAabb(map.collision, state, playerHalfSize(config), { x: vx * dt, y: vy * dt });
  return {
    x: moved.x,
    y: moved.y,
    vx: moved.hitX ? 0 : vx,
    vy: moved.hitY ? 0 : vy,
  };
}
