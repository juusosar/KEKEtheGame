// Path following for one NPC (M5-3). A* (`findPath`) runs only on events, never every tick (M5-1 handoff):
// a new goal more than a tile from the last one, a stock cart parked or removed, the NPC stuck against
// something for half a second, or (after a failed search) a second later. A goal in a straight clear line
// skips the search. Movement goes through `moveAabb`, so walls and carts always hold.
import {
  advanceAlongPath,
  findPath,
  moveAabb,
  walkableLine,
  type CollisionGrid,
  type HalfSize,
  type Vec2,
} from '@keke/shared';
import type { WalkResult } from './types';

/** Seconds of being blocked before the path is searched again. */
const STUCK_SECONDS = 0.5;
/** Seconds before a failed search for the same goal is tried again. */
const RETRY_SECONDS = 1;

export interface WalkStep {
  readonly position: Vec2;
  readonly result: WalkResult;
  /** Unit direction of this step's movement, or null when it did not move. */
  readonly dir: Vec2 | null;
}

export class Walker {
  private path: Vec2[] | null = null;
  private goal: Vec2 | null = null;
  private failedAt: number | null = null;
  private cartsVersion = -1;
  private stuckFor = 0;
  /** Path searches so far (A* or straight line), for tests. */
  searches = 0;

  /** Forget the current path (the NPC stopped, respawned or got a new job). */
  clear(): void {
    this.path = null;
    this.goal = null;
    this.failedAt = null;
    this.stuckFor = 0;
  }

  step(
    grid: CollisionGrid,
    position: Vec2,
    half: HalfSize,
    goal: Vec2,
    distance: number,
    dt: number,
    now: number,
    cartsVersion: number,
  ): WalkStep {
    if (Math.hypot(goal.x - position.x, goal.y - position.y) < 0.5) {
      this.path = [];
      this.goal = { x: goal.x, y: goal.y };
      return { position, result: 'arrived', dir: null };
    }
    const goalMoved =
      this.goal === null || Math.hypot(goal.x - this.goal.x, goal.y - this.goal.y) > grid.tileSize;
    if (goalMoved) this.failedAt = null;
    const due =
      this.path === null || goalMoved || cartsVersion !== this.cartsVersion || this.stuckFor >= STUCK_SECONDS;
    if (due) {
      if (this.failedAt !== null && now - this.failedAt < RETRY_SECONDS) {
        return { position, result: 'unreachable', dir: null };
      }
      this.search(grid, position, half, goal, now, cartsVersion);
      if (this.path === null) return { position, result: 'unreachable', dir: null };
    } else if (this.goal !== null && (this.goal.x !== goal.x || this.goal.y !== goal.y)) {
      // A goal that moved a little (a walking target): keep the path, end it at the new spot.
      const path = this.path ?? [];
      this.path = [...path.slice(0, -1), { x: goal.x, y: goal.y }];
      this.goal = { x: goal.x, y: goal.y };
    }

    const path = this.path ?? [];
    const planned = advanceAlongPath(position, path, distance);
    const want = { x: planned.position.x - position.x, y: planned.position.y - position.y };
    const moved = moveAabb(grid, position, half, want);
    const wanted = Math.hypot(want.x, want.y);
    const went = Math.hypot(moved.x - position.x, moved.y - position.y);
    const blocked = wanted > 1e-6 && went < wanted * 0.5;
    this.stuckFor = blocked ? this.stuckFor + dt : 0;
    if (!blocked) this.path = [...planned.path];
    const dir = went > 1e-6 ? { x: (moved.x - position.x) / went, y: (moved.y - position.y) / went } : null;
    const arrived = !blocked && planned.arrived;
    return { position: { x: moved.x, y: moved.y }, result: arrived ? 'arrived' : 'walking', dir };
  }

  private search(
    grid: CollisionGrid,
    position: Vec2,
    half: HalfSize,
    goal: Vec2,
    now: number,
    cartsVersion: number,
  ): void {
    this.searches++;
    this.goal = { x: goal.x, y: goal.y };
    this.cartsVersion = cartsVersion;
    this.stuckFor = 0;
    const radius = Math.max(half.hw, half.hh);
    if (walkableLine(grid, position, goal, radius)) {
      this.path = [{ x: goal.x, y: goal.y }];
      this.failedAt = null;
      return;
    }
    const path = findPath(grid, position, goal, { radius });
    this.path = path;
    this.failedAt = path === null ? now : null;
  }
}
