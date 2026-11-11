// Cross-map sessions (Phase 2, P3-3): every per-map system of the second store (self-checkout gates, the
// bakery oven, customers, pushable carts) shows up in a Both session on the second map, is gone on the
// first map, and comes back fresh after a switch back (a second session), with the clients' decoded
// state equal to the server's at every step. Also: in the lobby the room's systems run on the map the
// lobby shows (P1 review F5).
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, loadConfig, playerHalfSize, type InputFrame, type Vec2 } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';
import { diffStates } from './soak/diff';

// Own port (P3-3).
const PORT = 2612;

// Long phases: the test steps the room with advancePhase().
const config = loadConfig({
  ...loadConfig(),
  roundStartProtectionSeconds: 0,
  countdownSeconds: 60,
  timedRoundSeconds: 60,
  raceRoundSeconds: 60,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
});
const maps = loadMapRegistry();
const FIRST = 'kespro';
const SECOND = 'prisma';
const half = playerHalfSize(config);
const CART_HALF = config.cartSizePx / 2;

const oven = maps.get(SECOND).map.zones.find((z) => z.id === 'oven');
if (!oven) throw new Error('the second map has no oven');
const OVEN: Vec2 = {
  x: (oven.bounds.minX + oven.bounds.maxX) / 2,
  y: (oven.bounds.minY + oven.bounds.maxY) / 2,
};

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  seq: number;
}

async function waitFor(check: () => boolean, timeoutMs = 3000, what = 'a condition'): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('per-map systems across a map switch and back (integration, P3-3)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    const server = createGameServer({ config, maps });
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

  async function lobby(count: number): Promise<{ room: GameRoom; players: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const conns = [host];
    for (let i = 1; i < count; i++) {
      const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: `G${i}` })) as Conn;
      open.push(guest);
      await guest.waitForInitialState();
      conns.push(guest);
    }
    for (const c of conns) c.reconnection.enabled = false;
    return { room, players: conns.map((conn) => ({ conn, seq: 0 })) };
  }

  async function start(room: GameRoom, players: Player[], settings: Record<string, unknown>): Promise<void> {
    const host = must(players[0]).conn;
    host.send(ClientMessage.settings, settings);
    await waitFor(() =>
      Object.entries(settings).every(
        ([k, v]) => (room.state.settings as unknown as Record<string, unknown>)[k] === v,
      ),
    );
    for (const p of players) p.conn.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((pl) => pl.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
  }

  function me(room: GameRoom, p: Player): PlayerState {
    return must(room.state.players.get(p.conn.sessionId));
  }

  function place(player: PlayerState, at: Vec2): void {
    player.x = at.x;
    player.y = at.y;
    player.vx = 0;
    player.vy = 0;
  }

  /** Walks `frames` input frames at a client's pace and waits until the server applied them. */
  async function walk(room: GameRoom, p: Player, move: Vec2, frames: number): Promise<void> {
    let last = 0;
    for (let i = 0; i < frames; i++) {
      const frame: InputFrame = { seq: ++p.seq, move, aim: 0, buttons: 0 };
      p.conn.send(ClientMessage.input, frame);
      last = frame.seq;
      await sleep(1000 / config.inputHz);
    }
    await waitFor(() => me(room, p).ack === last);
  }

  /** Every client's decoded state equals the server's (the soak's desync diff), once the patches are in. */
  async function inSync(room: GameRoom, players: Player[], label: string): Promise<void> {
    let diffs: string[] = [];
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const server = room.state.toJSON();
      diffs = players.flatMap((p, i) =>
        diffStates(server, p.conn.state.toJSON()).map((d) => `client ${i + 1}: ${d}`),
      );
      if (diffs.length === 0) return;
      await sleep(20);
    }
    throw new Error(`${label}: clients out of sync: ${diffs.slice(0, 5).join('; ')}`);
  }

  const customers = (state: GameState) => [...state.npcs.values()].filter((n) => n.type === 'customer');

  /** Nothing of the second store's twists is in the room, its systems or any client. */
  function expectFirstMap(room: GameRoom, players: Player[]): void {
    expect(room.state.mapId).toBe(FIRST);
    expect(room.currentMap.id).toBe(FIRST);
    const map = room.currentMap.map;
    expect(map.gates).toEqual([]);
    expect(map.cartSpawns).toEqual([]);
    expect(map.zones.filter((z) => z.damagePerSecond !== undefined)).toEqual([]);
    expect(room.state.carts.size).toBe(0);
    expect(room.cartSystem.bodies).toEqual([]);
    expect(customers(room.state)).toEqual([]);
    expect(room.npcSystem.solidBodies()).toEqual([]);
    for (const p of players) {
      expect(p.conn.state.carts.size).toBe(0);
      expect(customers(p.conn.state)).toEqual([]);
      expect(me(room, p).gateStop).toBe(0);
    }
  }

  /** The second store's twists, fresh: carts at their spawns, the whole crowd at full health. */
  function expectSecondMap(room: GameRoom, playerCount: number): void {
    expect(room.state.mapId).toBe(SECOND);
    expect(room.currentMap.id).toBe(SECOND);
    const map = room.currentMap.map;
    expect(map.gates.length).toBeGreaterThan(0);
    expect(map.zones.some((z) => z.id === 'oven' && (z.damagePerSecond ?? 0) > 0)).toBe(true);
    expect(room.state.carts.size).toBe(map.cartSpawns.length);
    expect(map.cartSpawns.length).toBe(8);
    map.cartSpawns.forEach((spawn, i) => {
      expect(room.state.carts.get(String(i + 1))).toMatchObject({ x: spawn.x, y: spawn.y, dir: spawn.dir });
    });
    const crowd = customers(room.state);
    expect(crowd).toHaveLength(6 + playerCount);
    for (const c of crowd) expect(c).toMatchObject({ alive: true, hp: c.maxHp });
    expect(room.npcSystem.solidBodies()).toHaveLength(crowd.length);
    for (const p of room.state.players.values()) {
      expect(p.gateStop).toBe(0);
      expect(p.hp).toBe(config.maxHp);
    }
  }

  it(
    'a Both session brings the gates, oven, customers and carts with the second map, and back again fresh',
    { timeout: 30_000 },
    async () => {
      const { room, players } = await lobby(2);
      const [a, b] = players as [Player, Player];

      // --- Session 1, round 1: the first map. --------------------------------------------------------
      await start(room, players, { maps: 'both', roundsPerMap: 1, mode: 'timed' });
      expectFirstMap(room, players);
      room.advancePhase(); // playing
      await inSync(room, players, 'session 1 round 1');
      expectFirstMap(room, players);
      // Standing where the oven is on the second map burns nobody here.
      place(me(room, a), OVEN);
      await sleep(config.hazardTickSeconds * 1000 * 2 + 200);
      expect(me(room, a).hp).toBe(config.maxHp);

      room.advancePhase(); // roundResults
      room.advancePhase(); // countdown of round 2: the second map
      expect(room.state.round).toBe(2);
      expectSecondMap(room, 2);
      room.advancePhase(); // playing
      await inSync(room, players, 'session 1 round 2');

      // Use the twists: one player stands on the oven floor, the other pushes cart 1 out of the corral.
      const cart = must(room.cartSystem.bodies[0]);
      const spawn = { x: cart.x, y: cart.y };
      place(me(room, b), { x: spawn.x + CART_HALF + half.hw, y: spawn.y });
      place(me(room, a), OVEN);
      await walk(room, b, { x: -1, y: 0 }, 15);
      await waitFor(() => (room.state.carts.get('1')?.x ?? spawn.x) < spawn.x - 20, 3000, 'cart 1 pushed');
      await waitFor(() => me(room, a).hp < config.maxHp, 3000, 'the oven burns');
      await inSync(room, players, 'session 1 round 2 after the push');

      room.advancePhase(); // roundResults
      room.advancePhase(); // podium
      room.advancePhase(); // lobby
      expect(room.state.phase).toBe('lobby');
      // The lobby shows the first map, and the room's systems run on it again (P1 review F5).
      expect(room.state.mapId).toBe(FIRST);
      expect(room.currentMap.id).toBe(FIRST);
      expect(room.state.carts.size).toBe(0);
      expect(room.state.npcs.size).toBe(0);
      await inSync(room, players, 'lobby');

      // --- Session 2: back on the first map, then the second map fresh. --------------------------------
      await start(room, players, { mode: 'race' });
      expectFirstMap(room, players);
      room.advancePhase(); // playing
      await inSync(room, players, 'session 2 round 1');
      expectFirstMap(room, players);
      room.advancePhase(); // roundResults
      room.advancePhase(); // countdown of round 2
      // The pushed cart is back at its spawn, the burnt player at full health, the crowd new.
      expectSecondMap(room, 2);
      room.advancePhase(); // playing
      await inSync(room, players, 'session 2 round 2');
      // The oven burns again from a fresh clock: the first burn lands at once.
      place(me(room, a), OVEN);
      await waitFor(() => me(room, a).hp < config.maxHp, 3000, 'the oven burns in session 2');
    },
  );

  it('the lobby rebuilds the systems for the map the host picks (P1 review F5)', async () => {
    const { room, players } = await lobby(1);
    const host = must(players[0]).conn;
    expect(room.currentMap.id).toBe(FIRST);
    host.send(ClientMessage.settings, { maps: SECOND });
    await waitFor(() => room.state.mapId === SECOND);
    expect(room.currentMap.id).toBe(SECOND);
    // Nothing of the round is built yet: carts and customers come at the countdown.
    expect(room.state.carts.size).toBe(0);
    expect(room.state.npcs.size).toBe(0);
    expect(room.currentConfig.raceQuota).toBe(room.state.raceQuota);
    host.send(ClientMessage.settings, { maps: 'both' });
    await waitFor(() => room.state.mapId === FIRST);
    expect(room.currentMap.id).toBe(FIRST);
    await inSync(room, players, 'lobby');
  });
});

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('missing');
  return value;
}
