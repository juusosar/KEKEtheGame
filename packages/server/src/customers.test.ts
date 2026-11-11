// Customers through a real room on the second store map (Phase 2 decision 8, P2-3): the crowd in the
// synced state (6 + players, in groups), none on the first map, a player stopped by a customer's body,
// and a fight between players that makes nearby customers panic (and not far ones) until they shop again.
// The oven's burns are not a fight: they never scare the crowd (P2 review F1).
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  aabbOverlapsSolid,
  getNpcCatalogue,
  loadConfig,
  playerHalfSize,
  type InputFrame,
  type Vec2,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, NpcState, PlayerState } from './schema/GameState';

// Own port (P2-3): 2605.
const PORT = 2605;

const config = loadConfig({
  ...loadConfig(),
  roundStartProtectionSeconds: 0,
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});
const maps = loadMapRegistry();
const SECOND = 'prisma';
const prisma = maps.get(SECOND).map;
const customerDef = getNpcCatalogue().require('customer');
if (customerDef.behaviour !== 'customer') throw new Error('customer is not a customer');
const panic = customerDef.panic;
const TILE = config.tileSize;

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** `count` floor tile centres in a horizontal run starting at a free tile near `from` (player-sized free). */
function floorRun(from: Vec2, count: number): Vec2[] {
  const half = playerHalfSize(config);
  for (let r = 0; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.floor(from.x / TILE) + dx;
        const ty = Math.floor(from.y / TILE) + dy;
        const run = Array.from({ length: count }, (_, i) => ({
          x: (tx + i + 0.5) * TILE,
          y: (ty + 0.5) * TILE,
        }));
        if (run.every((p) => !aabbOverlapsSolid(prisma.collision, p, half))) return run;
      }
    }
  }
  throw new Error('no floor run');
}

describe('GameRoom customers (integration, P2-3)', () => {
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

  async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function playingRoom(
    count: number,
    mapChoice: string,
    roundsPerMap?: number,
  ): Promise<{ room: GameRoom; players: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    host.send(ClientMessage.settings, {
      maps: mapChoice,
      ...(roundsPerMap === undefined ? {} : { roundsPerMap }),
    });
    await waitFor(
      () =>
        room.state.settings.maps === mapChoice &&
        (roundsPerMap === undefined || room.state.settings.roundsPerMap === roundsPerMap),
    );
    const conns = [host];
    for (let i = 1; i < count; i++) {
      const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: `G${i}` })) as Conn;
      open.push(guest);
      await guest.waitForInitialState();
      conns.push(guest);
    }
    const players = conns.map((conn): Player => {
      conn.reconnection.enabled = false;
      const me = room.state.players.get(conn.sessionId);
      if (!me) throw new Error('no player');
      return { conn, me, seq: 0 };
    });
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((pl) => pl.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, players };
  }

  async function send(p: Player, move: Vec2, buttons = 0, aim = 0): Promise<void> {
    const frame: InputFrame = { seq: ++p.seq, move, aim, buttons };
    p.conn.send(ClientMessage.input, frame);
    await waitFor(() => p.me.ack === frame.seq);
  }

  const customersOf = (room: GameRoom): NpcState[] =>
    [...room.state.npcs.values()].filter((n) => n.behaviour === 'customer');

  /** Puts a customer at `at` and keeps it there for `seconds` (debug hold). */
  function park(room: GameRoom, id: string, at: Vec2, seconds = 20): void {
    const npc = room.npcSystem.npc(id);
    if (!npc) throw new Error(`no ${id}`);
    npc.state.x = at.x;
    npc.state.y = at.y;
    room.npcSystem.holdForTest(id, seconds);
  }

  it('a round on the second map has 6 + players customers in groups, synced; the first map has none', async () => {
    const { room, players } = await playingRoom(2, SECOND);
    expect(room.state.mapId).toBe(SECOND);
    const crowd = customersOf(room);
    expect(crowd).toHaveLength(8);
    const groups = crowd.map((c) => room.npcSystem.npc(c.id)?.placement.group);
    expect(groups).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    const client = must(players[0]).conn;
    await waitFor(() => [...client.state.npcs.values()].filter((n) => n.type === 'customer').length === 8);
    const synced = [...client.state.npcs.values()].find((n) => n.type === 'customer');
    expect(synced).toMatchObject({ behaviour: 'customer', hp: 30, maxHp: 30, alive: true });
    // The group browses together after a short walk to its waypoint.
    await waitFor(() => customersOf(room).some((c) => c.mode === 'browse'), 8000);

    const first = await playingRoom(1, 'kespro');
    expect(customersOf(first.room)).toHaveLength(0);
    expect(first.room.npcSystem.solidBodies()).toEqual([]);
  });

  it('customers come with the second map in a Both session and leave with it (P3-1 map switch)', async () => {
    const { room } = await playingRoom(1, 'both', 1);
    expect(room.state.mapId).toBe('kespro');
    expect(customersOf(room)).toHaveLength(0);
    room.advancePhase(); // roundResults
    room.advancePhase(); // countdown of round 2, on the second map
    expect(room.state.mapId).toBe(SECOND);
    expect(customersOf(room)).toHaveLength(7);
    expect(room.npcSystem.solidBodies()).toHaveLength(7);
    room.advancePhase(); // playing
    room.advancePhase(); // roundResults
    room.advancePhase(); // podium
    room.advancePhase(); // lobby
    expect(room.state.phase).toBe('lobby');
    expect(customersOf(room)).toHaveLength(0);
    expect(room.npcSystem.solidBodies()).toEqual([]);
  });

  it('a customer body stops a player walking into it', async () => {
    const { room, players } = await playingRoom(1, SECOND);
    const p = must(players[0]);
    const [at, , , , body] = floorRun(must(prisma.npcWaypoints[3]), 5) as [Vec2, Vec2, Vec2, Vec2, Vec2];
    // Everyone else out of the way: hold them all at their spot, this one in the path.
    const id = must(customersOf(room)[0]).id;
    for (const c of customersOf(room)) room.npcSystem.holdForTest(c.id, 20);
    park(room, id, body);
    for (const c of customersOf(room))
      if (c.id !== id && dist(c, at) < 6 * TILE) park(room, c.id, { x: 0, y: 0 });
    p.me.x = at.x;
    p.me.y = at.y;
    for (let i = 0; i < 25; i++) await send(p, { x: 1, y: 0 });
    const touching = customerDef.hitboxPx / 2 + config.playerHitboxSize / 2;
    expect(body.x - p.me.x).toBeGreaterThanOrEqual(touching - 0.5);
    expect(body.x - p.me.x).toBeLessThan(touching + 9);
    expect(Math.abs(p.me.y - at.y)).toBeLessThan(1);
  });

  it('a punch between players makes customers within 5 tiles panic and run, not farther ones; then they shop again', async () => {
    const { room, players } = await playingRoom(2, SECOND);
    const [a, b] = players as [Player, Player];
    // The fight: a at `at`, b right next to it.
    const [at] = floorRun(must(prisma.npcWaypoints[3]), 2) as [Vec2];
    a.me.x = at.x;
    a.me.y = at.y;
    b.me.x = at.x + 24;
    b.me.y = at.y;
    const crowd = customersOf(room);
    const near = must(crowd[0]);
    const far = must(crowd[4]);
    // Free-standing customers: the near one 3 tiles from b, the far one at least 7 tiles away.
    const nearAt = floorRun({ x: b.me.x, y: b.me.y - 3 * TILE }, 1)[0] as Vec2;
    const farAt = must(
      crowd.map((c) => ({ x: c.x, y: c.y })).find((c) => dist(c, b.me) > (panic.radiusTiles + 2) * TILE),
    );
    // Everyone else far away and still.
    for (const c of crowd) if (c.id !== near.id) park(room, c.id, farAt);
    park(room, near.id, nearAt, 0.01);
    expect(dist(nearAt, b.me)).toBeLessThanOrEqual(panic.radiusTiles * TILE);
    await new Promise((r) => setTimeout(r, 100));
    expect(near.mode).not.toBe('panic');

    const hpBefore = b.me.hp;
    await send(a, { x: 0, y: 0 }, Button.Attack, 0);
    await waitFor(() => b.me.hp < hpBefore);
    await waitFor(() => near.mode === 'panic');
    expect(far.mode).not.toBe('panic');
    const start = { x: near.x, y: near.y };
    await new Promise((r) => setTimeout(r, 500));
    // It runs away from where b was hit (it started 3 tiles above).
    expect(dist(near, b.me)).toBeGreaterThan(dist(start, b.me));
    expect(near.y).toBeLessThan(start.y);
    // 4 s later it is back to shopping.
    await waitFor(() => near.mode === 'walk' || near.mode === 'browse', panic.seconds * 1000 + 1500);
    expect(far.mode).not.toBe('panic');
  });

  it('a player burning on the oven does not scare customers next to the bakery (P2 review F1)', async () => {
    const { room, players } = await playingRoom(1, SECOND);
    const [a] = players as [Player];
    const oven = must(
      prisma.zones.find((z) => z.id === 'oven'),
      'oven',
    );
    const hot = {
      x: (oven.bounds.minX + oven.bounds.maxX) / 2,
      y: (oven.bounds.minY + oven.bounds.maxY) / 2,
    };
    const crowd = customersOf(room);
    const near = must(crowd[0]);
    const nearAt = floorRun({ x: oven.bounds.maxX + 3 * TILE, y: hot.y }, 1)[0] as Vec2;
    expect(dist(nearAt, hot)).toBeLessThanOrEqual(panic.radiusTiles * TILE);
    const farAt = must(
      crowd.map((c) => ({ x: c.x, y: c.y })).find((c) => dist(c, hot) > (panic.radiusTiles + 2) * TILE),
    );
    for (const c of crowd) if (c.id !== near.id) park(room, c.id, farAt);
    park(room, near.id, nearAt);
    a.me.x = hot.x;
    a.me.y = hot.y;
    // Three burns land (one every hazardTickSeconds); the customer keeps shopping.
    const burn = must(oven.damagePerSecond, 'oven damage') * config.hazardTickSeconds;
    const hpBefore = a.me.hp;
    await waitFor(() => a.me.hp <= hpBefore - 3 * burn + 0.01, 5000);
    expect(near.mode).not.toBe('panic');
    expect(crowd.every((c) => c.mode !== 'panic')).toBe(true);
  });
});

function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}
