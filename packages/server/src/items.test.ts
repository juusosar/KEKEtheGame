import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  ItemEventMessage,
  applyInput,
  defaultThemeId,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type DepositMessage,
  type DropMessage,
  type InputFrame,
  type PickupMessage,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own port: other integration files use 2568, 2571, 2572 and 2574, and test files run in parallel.
const PORT = 2575;

const LOOSE_SECONDS = 0.6;
const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
  reconnectWindowSeconds: 5,
  looseItemDespawnSeconds: LOOSE_SECONDS,
});
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
  events: { type: string; payload: unknown }[];
}

describe('GameRoom items and vans (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    // boot() ignores its port argument for a Server instance, so listen here instead.
    const server = createGameServer({ config, maps: singleMapRegistry(map), npcs: false });
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

  function wrap(room: GameRoom, conn: Conn): Player {
    conn.reconnection.enabled = false;
    const me = room.state.players.get(conn.sessionId);
    if (!me) throw new Error(`no player for ${conn.sessionId}`);
    const player: Player = { conn, me, seq: 0, events: [] };
    for (const type of Object.values(ItemEventMessage)) {
      conn.onMessage(type, (payload: unknown) => player.events.push({ type, payload }));
    }
    return player;
  }

  /** A started room in 'playing' with `count` players; `teams` turns the Teams option on first. */
  async function playingRoom(count: number, teams = false): Promise<{ room: GameRoom; players: Player[] }> {
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
    if (teams) {
      host.send(ClientMessage.settings, { teams: true });
      await waitFor(() => room.state.settings.teams);
    }
    const players = conns.map((c) => wrap(room, c));
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, players };
  }

  /** Sends one frame and waits until the server applied it. */
  async function press(p: Player, buttons = 0, move = { x: 0, y: 0 }): Promise<InputFrame> {
    const frame: InputFrame = { seq: ++p.seq, move, aim: 0, buttons };
    p.conn.send(ClientMessage.input, frame);
    await waitFor(() => p.me.ack === frame.seq);
    return frame;
  }

  /** Puts a player's body somewhere at rest (the server reads it on the next frame). */
  function teleport(p: Player, pos: { x: number; y: number }): void {
    p.me.x = pos.x;
    p.me.y = pos.y;
    p.me.vx = 0;
    p.me.vy = 0;
  }

  function item(room: GameRoom, id: number) {
    const it = room.state.items.get(String(id));
    if (!it) throw new Error(`no item ${id}`);
    return it;
  }

  /** Picks up the player's own target with E. Returns the world item id. */
  async function pickUpOwnTarget(room: GameRoom, p: Player): Promise<number> {
    const id = p.me.target;
    const target = item(room, id);
    teleport(p, { x: target.x, y: target.y });
    await press(p, Button.Interact);
    await press(p); // release E
    expect(p.me.carrying).toBe(id);
    return id;
  }

  it('assigns vans in join order, spawns players there and gives everyone a target', async () => {
    const { room, players } = await playingRoom(3);
    const half = playerHalfSize(config);
    players.forEach((p, i) => {
      expect(p.me.van).toBe(i);
      expect({ x: p.me.x, y: p.me.y }).toEqual(vanSpawn(map, i, half));
      expect(p.me.target).toBeGreaterThan(0);
      const target = item(room, p.me.target);
      expect(target.state).toBe('target');
      expect(target.owner).toBe(p.conn.sessionId);
      expect(target.itemId).not.toBe('');
    });
    expect([...room.state.vans.keys()].sort()).toEqual(['0', '1', '2']);
    // The client sees its own target and the targetAssigned events.
    const [first] = players;
    if (!first) throw new Error('no players');
    await waitFor(() => first.conn.state.items?.size === 3);
    expect(first.conn.state.players.get(first.conn.sessionId)?.target).toBe(first.me.target);
  });

  it('puts teammates in one shared van in the first slots, and keeps vans for the next round', async () => {
    const { room, players } = await playingRoom(4, true);
    for (const p of players) expect(p.me.van).toBe(p.me.team - 1);
    expect([...room.state.vans.values()].map((v) => [v.van, v.team]).sort()).toEqual([
      [0, 1],
      [1, 2],
    ]);
    const vans = players.map((p) => p.me.van);
    room.advancePhase(); // roundResults
    room.advancePhase(); // podium (1 round)
    room.advancePhase(); // lobby
    expect(room.state.items.size).toBe(0);
    expect(players.map((p) => p.me.van)).toEqual(vans);
  });

  it('E picks up the nearest item in reach and the carrier moves at 0.85 speed', async () => {
    const { room, players } = await playingRoom(1);
    const [p] = players;
    if (!p) throw new Error('no player');

    // Out of reach: nothing happens.
    teleport(p, vanSpawn(map, p.me.van, playerHalfSize(config)));
    await press(p, Button.Interact);
    await press(p);
    expect(p.me.carrying).toBe(0);

    const id = await pickUpOwnTarget(room, p);
    expect(item(room, id).state).toBe('carried');
    expect(item(room, id).carrier).toBe(p.conn.sessionId);
    expect(p.me.target).toBe(0); // own target picked up: no target while carrying (§3.1)
    await waitFor(() => p.events.some((e) => e.type === 'pickup'));
    const pickup = p.events.find((e) => e.type === 'pickup')?.payload as PickupMessage;
    expect(pickup).toMatchObject({ player: p.conn.sessionId, kind: 'own_target', item: { id } });

    // Away from the meat counter before measuring: the target may lie behind it, where the butcher's
    // cleaver knocks us back (M5-6). An item spawn far from our van will do (no auto deposit).
    if (map.zoneAt(p.me.x, p.me.y)?.id === 'behind_counter') {
      const home = vanSpawn(map, p.me.van, playerHalfSize(config));
      const away = map.itemSpawns.find(
        (i) =>
          !['meat_fish', 'behind_counter'].includes(map.zoneAt(i.x, i.y)?.id ?? '') &&
          Math.hypot(i.x - home.x, i.y - home.y) > map.tileSize * 6,
      );
      if (!away) throw new Error('no item spot away from the counter');
      teleport(p, { x: away.x, y: away.y });
    }
    const from = { x: p.me.x, y: p.me.y, vx: p.me.vx, vy: p.me.vy };
    const frame = await press(p, 0, { x: 1, y: 0 });
    const slow = applyInput(from, frame, map, config, { speedMultiplier: config.carrySpeedMultiplier });
    expect(p.me.carrying).toBe(id);
    expect(p.me.x).toBe(slow.x);
    expect(p.me.x).toBeLessThan(applyInput(from, frame, map, config).x);
  });

  it('only a new press of E counts, not a held button', async () => {
    const { room, players } = await playingRoom(1);
    const [p] = players;
    if (!p) throw new Error('no player');
    teleport(p, vanSpawn(map, p.me.van, playerHalfSize(config)));
    await press(p, Button.Interact);
    const target = item(room, p.me.target);
    teleport(p, { x: target.x, y: target.y });
    await press(p, Button.Interact); // still held from the frame before
    expect(p.me.carrying).toBe(0);
    await press(p);
    await press(p, Button.Interact);
    expect(p.me.carrying).toBe(target.id);
  });

  it('Q drops the item loose, the dropper gets a new target and the loose item despawns', async () => {
    const { room, players } = await playingRoom(1);
    const [p] = players;
    if (!p) throw new Error('no player');
    const id = await pickUpOwnTarget(room, p);
    await press(p, Button.Drop);
    expect(p.me.carrying).toBe(0);
    expect(item(room, id).state).toBe('loose');
    expect(p.me.target).toBeGreaterThan(0);
    expect(p.me.target).not.toBe(id);
    await waitFor(() => p.events.some((e) => e.type === 'drop'));
    expect((p.events.find((e) => e.type === 'drop')?.payload as DropMessage).reason).toBe('drop');

    await waitFor(() => !room.state.items.has(String(id)), (LOOSE_SECONDS + 1) * 1000);
    await waitFor(() => p.events.some((e) => e.type === 'despawn'));
  });

  it('a carrier at their own van deposits: the van banks the points and a new target appears', async () => {
    const { room, players } = await playingRoom(2);
    const [p, other] = players;
    if (!p || !other) throw new Error('no players');
    const id = await pickUpOwnTarget(room, p);
    const points = item(room, id).rarity === 'joke' ? config.jokeItemValue : 1;

    // Someone else's van does not take it.
    teleport(p, vanSpawn(map, other.me.van, playerHalfSize(config)));
    await press(p);
    expect(p.me.carrying).toBe(id);

    teleport(p, vanSpawn(map, p.me.van, playerHalfSize(config)));
    await press(p);
    expect(p.me.carrying).toBe(0);
    expect(room.state.items.has(String(id))).toBe(false);
    expect(p.me.deposited).toBe(points);
    expect(room.state.vans.get(String(p.me.van))?.points).toBe(points);
    expect(p.me.target).toBeGreaterThan(0);
    await waitFor(() => other.events.some((e) => e.type === 'deposit'));
    const deposit = other.events.find((e) => e.type === 'deposit')?.payload as DepositMessage;
    expect(deposit).toMatchObject({ player: p.conn.sessionId, van: p.me.van, points, vanTotal: points });
  });

  it("taking someone else's target gives its owner a new target at once", async () => {
    const { room, players } = await playingRoom(2);
    const [thief, victim] = players;
    if (!thief || !victim) throw new Error('no players');
    const own = thief.me.target;
    const stolen = victim.me.target;
    teleport(thief, { x: item(room, stolen).x, y: item(room, stolen).y });
    await press(thief, Button.Interact);
    expect(thief.me.carrying).toBe(stolen);
    expect(thief.me.target).toBe(own);
    expect(victim.me.target).toBeGreaterThan(0);
    expect(victim.me.target).not.toBe(stolen);
    expect(item(room, victim.me.target).owner).toBe(victim.conn.sessionId);
  });

  it('drops the carried item on disconnect; a final leave despawns the leaver target', async () => {
    const { room, players } = await playingRoom(3);
    const [p, watcher] = players;
    if (!p || !watcher) throw new Error('no players');
    const id = await pickUpOwnTarget(room, p);
    const pos = { x: p.me.x, y: p.me.y };
    const sessionId = p.conn.sessionId;
    await p.conn.leave(false); // unexpected drop: the reconnect window opens
    await waitFor(() => room.state.players.get(sessionId)?.connected === false);
    expect(item(room, id).state).toBe('loose');
    expect({ x: item(room, id).x, y: item(room, id).y }).toEqual(pos);
    await waitFor(() => watcher.events.some((e) => e.type === 'drop'));
    expect((watcher.events.find((e) => e.type === 'drop')?.payload as DropMessage).reason).toBe('disconnect');

    // Inside the window the dropped player stays in the round and gets a new target.
    expect(room.state.players.get(sessionId)?.target ?? 0).toBeGreaterThan(0);

    // A consented leave is final: the leaver's target despawns, nothing else changes.
    const leaverTarget = watcher.me.target;
    const watcherId = watcher.conn.sessionId;
    await watcher.conn.leave(true);
    await waitFor(() => !room.state.players.has(watcherId));
    expect(room.state.items.has(String(leaverTarget))).toBe(false);
    expect(room.itemWorld.players.map((x) => x.id)).not.toContain(watcherId);
  });
});
