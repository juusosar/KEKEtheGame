// Pushable shopping carts (Phase 2 decision 12; P2-5). The server owns every cart: players push them
// frame by frame through the movement hook (`push`), released and shoved carts roll once per tick (`tick`),
// a pallet jack dash shoves the carts in its band (`shove`), and the bodies are mirrored into
// `GameState.carts` for the clients. The shared rules (`pushCarts`, `rollCarts`, `shoveCart`) are the
// same ones client prediction replays.
import {
  cartGrid,
  cartHalfSize,
  cartsSegmentTime,
  newCart,
  playerHalfSize,
  pushCarts,
  rollCarts,
  shoveCart,
  sweepHitTime,
  type Box,
  type CartBody,
  type CartWorld,
  type Circle,
  type CollisionGrid,
  type GameConfig,
  type MapModel,
  type MovementState,
  type Vec2,
} from '@keke/shared';
import { CartState, type GameState, type PlayerState } from '../schema/GameState';
import type { MapSystem } from './mapSystem';

/** Store workers that carts meet (customers, P2-3): solid bodies stop carts; a rolling cart that hits one scares the crowd. */
export interface CartNpcHooks {
  /** Solid NPC bodies (customers) right now. */
  solids(): readonly Circle[];
  /** A rolling cart crashed into a solid NPC at `at`: nearby customers panic (no damage, no Wanted). */
  bump(at: Vec2): void;
}

export class CartSystem implements MapSystem {
  private carts: CartBody[] = [];
  /** Walls, parked stock carts and gate tiles: carts never enter a gate lane (P2-1 x P2-5). */
  private readonly grid: CollisionGrid;

  constructor(
    private readonly state: GameState,
    private readonly config: GameConfig,
    /** The live map: walls and parked stock carts stop carts too. */
    private readonly map: MapModel,
    private readonly npcs: CartNpcHooks = { solids: () => [], bump: () => undefined },
  ) {
    this.grid = cartGrid(map.collision, map.gates);
  }

  /** The cart bodies, in id order (tests, debug). */
  get bodies(): readonly CartBody[] {
    return this.carts;
  }

  /** Countdown: every cart back at its spawn, at rest. A map without `cart_spawns` has none. */
  startRound(): void {
    this.carts = this.map.cartSpawns.map((spawn, i) => newCart(i + 1, spawn, spawn.dir));
    this.state.carts.clear();
    this.sync();
  }

  /** Lobby or a map rebuild: no carts in the synced state. */
  reset(): void {
    this.carts = [];
    this.state.carts.clear();
  }

  /**
   * One movement frame of `player` from `prev` to `next` (already through the walls): pushes the carts
   * they walk into and returns where they end up. Other living players stop carts.
   */
  push(player: PlayerState, prev: MovementState, next: MovementState, now: number): MovementState {
    if (this.carts.length === 0) return next;
    const result = pushCarts(prev, next, {
      world: this.world(player.sessionId),
      half: playerHalfSize(this.config),
      dt: 1 / this.config.inputHz,
      now,
      config: this.config,
    });
    return result.state;
  }

  /** One tick: released and shoved carts roll on, then the synced state follows. */
  tick(now: number): void {
    if (this.carts.length === 0) return;
    const rolling = this.carts.filter((c) => c.vx !== 0 || c.vy !== 0);
    const world = this.world(null);
    rollCarts(world, 1 / this.config.serverTickHz, now, this.config);
    // A rolling cart stopped dead against a customer: it bumped them (P2-3 x P2-5).
    const reach = this.config.cartSizePx / 2 + 1;
    for (const cart of rolling) {
      if (cart.vx !== 0 || cart.vy !== 0) continue;
      const hit = this.npcs
        .solids()
        .find((b) => Math.abs(b.x - cart.x) <= reach + b.r && Math.abs(b.y - cart.y) <= reach + b.r);
      if (hit) this.npcs.bump({ x: hit.x, y: hit.y });
    }
    this.sync();
  }

  /**
   * A pallet jack dash swept the band from→to (half width `halfWidth`) heading `dir`: every cart whose box
   * the band touches, except those in `skip`, is shoved. Returns the ids shoved.
   */
  shove(from: Vec2, to: Vec2, halfWidth: number, dir: Vec2, skip: ReadonlySet<number>): number[] {
    const reach = halfWidth + this.config.cartSizePx / 2;
    const delta = { x: to.x - from.x, y: to.y - from.y };
    const shoved: number[] = [];
    for (const cart of this.carts) {
      if (skip.has(cart.id)) continue;
      if (sweepHitTime(from, delta, cart, reach) === null) continue;
      shoveCart(cart, dir, this.config);
      shoved.push(cart.id);
    }
    return shoved;
  }

  /** Lines of sight and projectiles stop at carts (`CollisionGrid.segmentBlockedAt`). */
  segmentBlockedAt(from: Vec2, delta: Vec2): number | null {
    return this.carts.length === 0 ? null : cartsSegmentTime(this.carts, from, delta, this.config);
  }

  /** True when a body of half size `half` at `at` would overlap a cart (debug teleport checks). */
  overlaps(at: Vec2, half: { hw: number; hh: number }): boolean {
    const c = cartHalfSize(this.config);
    return this.carts.some(
      (cart) => Math.abs(cart.x - at.x) < c.hw + half.hw && Math.abs(cart.y - at.y) < c.hh + half.hh,
    );
  }

  private world(pusher: string | null): CartWorld {
    const half = playerHalfSize(this.config);
    const obstacles: Box[] = [];
    this.state.players.forEach((p) => {
      if (p.spectator || !p.alive || p.sessionId === pusher) return;
      obstacles.push({ x: p.x, y: p.y, hw: half.hw, hh: half.hh });
    });
    // Customers are solid (decision 8): carts stop at them too.
    for (const b of this.npcs.solids()) obstacles.push({ x: b.x, y: b.y, hw: b.r, hh: b.r });
    return { grid: this.grid, carts: this.carts, obstacles };
  }

  private sync(): void {
    for (const cart of this.carts) {
      const key = String(cart.id);
      let s = this.state.carts.get(key);
      if (!s) {
        s = new CartState();
        s.id = cart.id;
        this.state.carts.set(key, s);
      }
      if (s.x !== cart.x) s.x = cart.x;
      if (s.y !== cart.y) s.y = cart.y;
      if (s.dir !== cart.dir) s.dir = cart.dir;
    }
  }
}
