// Pushable shopping carts through a real room (Phase 2 decision 12; P2-5): carts start at the map's
// cart_spawns each round, a player walking into one pushes it and every client sees it move, a pallet jack
// dash shoves one, carts stop eggs, and the first map has none.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  DebugMessage,
  getTheme,
  loadConfig,
  playerHalfSize,
  type CartBody,
  type InputFrame,
  type Vec2,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own port (P2-5 was given 2606); integration files run in parallel.
const PORT = 2606;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
});
const half = playerHalfSize(config);
const CART = config.cartSizePx / 2;

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
}

describe('pushable carts (integration, P2-5)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];
  const maps = loadMapRegistry([getTheme('kespro'), getTheme('prisma')]);

  beforeAll(async () => {
    const server = createGameServer({ config, maps, npcs: false, debug: true });
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function playingRoom(map: 'kespro' | 'prisma'): Promise<{ room: GameRoom; players: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: 'Guest' })) as Conn;
    open.push(guest);
    await guest.waitForInitialState();
    host.send(ClientMessage.settings, { maps: map });
    await waitFor(() => room.state.settings.maps === map);
    for (const c of [host, guest]) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    const players = [host, guest].map((conn): Player => {
      conn.reconnection.enabled = false;
      const me = room.state.players.get(conn.sessionId);
      if (!me) throw new Error('no player');
      return { conn, me, seq: 0 };
    });
    return { room, players };
  }

  /** Sends `frames` input frames of walking `move` and waits until the server applied them all. */
  async function walk(p: Player, move: Vec2, frames: number, buttons = 0, aim = 0): Promise<void> {
    let last = 0;
    for (let i = 0; i < frames; i++) {
      const frame: InputFrame = { seq: ++p.seq, move, aim, buttons };
      p.conn.send(ClientMessage.input, frame);
      last = frame.seq;
      // Pace like a client so the input queue never trims.
      await new Promise((r) => setTimeout(r, 1000 / config.inputHz));
    }
    await waitFor(() => p.me.ack === last);
  }

  function firstCart(room: GameRoom): CartBody {
    const cart = room.cartSystem.bodies[0];
    if (!cart) throw new Error('no cart');
    return cart;
  }

  function place(p: Player, x: number, y: number): void {
    p.me.x = x;
    p.me.y = y;
    p.me.vx = 0;
    p.me.vy = 0;
  }

  it('starts the round with a cart at every cart spawn, synced to the clients', async () => {
    const { room, players } = await playingRoom('prisma');
    const spawns = room.currentMap.map.cartSpawns;
    expect(spawns).toHaveLength(8);
    expect(room.state.carts.size).toBe(8);
    for (const p of players) await waitFor(() => p.conn.state.carts.size === 8);
    spawns.forEach((spawn, i) => {
      const cart = room.state.carts.get(String(i + 1));
      expect(cart).toMatchObject({ id: i + 1, x: spawn.x, y: spawn.y, dir: spawn.dir });
    });
  });

  it('a player walking into a cart pushes it, and both players see it move', async () => {
    const { room, players } = await playingRoom('prisma');
    const [a, b] = players as [Player, Player];
    const cart = room.cartSystem.bodies[0];
    if (!cart) throw new Error('no cart');
    const start = { x: cart.x, y: cart.y };
    // Flush against the cart's east side, walking west out of the corral.
    place(a, start.x + CART + half.hw, start.y);
    await walk(a, { x: -1, y: 0 }, 15);
    await waitFor(() => (room.state.carts.get('1')?.x ?? start.x) < start.x - 20);
    const moved = room.state.carts.get('1');
    if (!moved) throw new Error('no cart 1');
    expect(moved.y).toBe(start.y);
    expect(moved.dir).toBe('left');
    // The pusher stays flush behind it (the cart may roll a little further once released).
    expect(a.me.x).toBeGreaterThanOrEqual(moved.x + CART + half.hw - 1e-6);
    // Slower than walking: 15 frames at full speed would cover more.
    expect(start.x + CART + half.hw - a.me.x).toBeLessThan(15 * (config.playerSpeed / config.inputHz));
    for (const p of [a, b]) await waitFor(() => (p.conn.state.carts.get('1')?.x ?? start.x) < start.x - 20);
    // Nothing else moved.
    for (const other of room.cartSystem.bodies.slice(1)) {
      const spawn = room.currentMap.map.cartSpawns[other.id - 1];
      expect({ x: other.x, y: other.y }).toEqual({ x: spawn?.x, y: spawn?.y });
    }
  });

  it('a cart that cannot move stops the player', async () => {
    const { room, players } = await playingRoom('prisma');
    const [a] = players as [Player];
    // Push cart 1 north into the corral rail row above it.
    const cart = firstCart(room);
    const railY = Math.floor(cart.y / config.tileSize) * config.tileSize - config.tileSize; // rail tile top
    place(a, cart.x, cart.y + CART + half.hh);
    await walk(a, { x: 0, y: -1 }, 30);
    // The cart is flush under the rail, the player flush under the cart.
    expect(cart.y).toBeCloseTo(railY + config.tileSize + CART, 6);
    expect(a.me.y).toBeCloseTo(cart.y + CART + half.hh, 6);
  });

  it('a cart pushed at a self-checkout lane stops short of it, so it never blocks the lane (P2-1)', async () => {
    const { room, players } = await playingRoom('prisma');
    const [a] = players as [Player];
    const ts = config.tileSize;
    const lane = room.currentMap.map.gates.find((g) => g.kind === 'checkout');
    if (!lane) throw new Error('no checkout gate');
    // A cart in the exit strip right under the lane, the player under it pushing north.
    const cart = firstCart(room);
    cart.x = lane.x + lane.width / 2;
    cart.y = lane.y + lane.height + ts + CART;
    place(a, cart.x, cart.y + CART + half.hh);
    await walk(a, { x: 0, y: -1 }, 20);
    expect(cart.y).toBeCloseTo(lane.y + lane.height + CART, 6);
    expect(a.me.y).toBeCloseTo(cart.y + CART + half.hh, 6);
  });

  it('a pallet jack dash shoves a cart about cartShoveTiles', async () => {
    const { room, players } = await playingRoom('prisma');
    const [a] = players as [Player];
    // Cart 1 pushed out into the open lot first, then charged from the east.
    const cart = firstCart(room);
    const startX = cart.x;
    place(a, cart.x + CART + half.hw, cart.y);
    await walk(a, { x: -1, y: 0 }, 30);
    await waitFor(() => cart.vx === 0);
    const before = cart.x;
    expect(before).toBeLessThan(startX - 3 * config.tileSize);
    a.conn.send(DebugMessage.giveWeapon, { weapon: 'pallet_jack' });
    await waitFor(() => a.me.weapon === 'pallet_jack');
    place(a, cart.x + 3 * config.tileSize, cart.y);
    await walk(a, { x: 0, y: 0 }, 1, Button.Attack, Math.PI);
    await waitFor(() => cart.vx < 0);
    await waitFor(() => cart.vx === 0 && cart.vy === 0, 4000);
    const tiles = (before - cart.x) / config.tileSize;
    expect(tiles).toBeGreaterThan(config.cartShoveTiles * 0.8);
    expect(tiles).toBeLessThan(config.cartShoveTiles + 2);
  });

  it('lines of sight stop at carts: the room grid reports a cart between two points', async () => {
    const { room } = await playingRoom('prisma');
    const cart = firstCart(room);
    const from = { x: cart.x + 3 * config.tileSize, y: cart.y };
    const delta = { x: -6 * config.tileSize, y: 0 };
    expect(room.cartSystem.segmentBlockedAt(from, delta)).not.toBeNull();
    expect(room.cartSystem.segmentBlockedAt({ x: from.x, y: cart.y + 40 }, delta)).toBeNull();
  });

  it('the first map has no carts', async () => {
    const { room } = await playingRoom('kespro');
    expect(room.currentMap.map.cartSpawns).toEqual([]);
    expect(room.state.carts.size).toBe(0);
  });
});
