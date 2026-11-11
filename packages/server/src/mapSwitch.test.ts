// Map switch between rounds (Phase 2, P3-1; decision 14): with Maps = Both the room rebuilds its map
// systems at the first countdown on the second map. Session totals, van slots and team sides carry over;
// items, NPCs, projectiles, traps and stock carts of the old map are gone; everyone starts at their van.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, loadConfig, playerHalfSize, vanSpawn } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry, type MapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';
import { FIXTURE_VAN_SLOTS, twoMapRegistry } from './testMaps';

// Own port (P3-1); integration files run in parallel.
const PORT = 2607;

// Long phases: the tests step the room with advancePhase().
const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 60,
  timedRoundSeconds: 60,
  raceRoundSeconds: 60,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
});

type Conn = ClientRoom<GameRoom, GameState>;

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function suite(name: string, port: number, maps: MapRegistry, npcs: boolean, body: (h: Harness) => void) {
  describe(name, () => {
    const harness = new Harness(maps);
    beforeAll(async () => {
      const server = createGameServer({ config, maps, npcs });
      await server.listen(port);
      harness.colyseus = new ColyseusTestServer(server);
    });
    afterEach(async () => {
      await Promise.all(
        harness.open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())),
      );
      await harness.colyseus.cleanup();
    });
    afterAll(async () => {
      await harness.colyseus.shutdown();
    });
    body(harness);
  });
}

class Harness {
  colyseus!: ColyseusTestServer;
  readonly open: Conn[] = [];
  constructor(readonly maps: MapRegistry) {}

  /** A lobby room with `count` players (the first is the host). */
  async lobby(count: number): Promise<{ room: GameRoom; host: Conn; conns: Conn[] }> {
    const host = (await this.colyseus.sdk.create('game', { nickname: 'P0' })) as Conn;
    this.open.push(host);
    await host.waitForInitialState();
    const room = this.colyseus.getRoomById<GameRoom>(host.roomId);
    const conns = [host];
    for (let i = 1; i < count; i++) conns.push(await this.join(room, `P${i}`));
    return { room, host, conns };
  }

  async join(room: GameRoom, nickname: string): Promise<Conn> {
    const conn = (await this.colyseus.sdk.join('game', { code: room.state.code, nickname })) as Conn;
    this.open.push(conn);
    await conn.waitForInitialState();
    return conn;
  }

  async start(room: GameRoom, host: Conn, conns: Conn[], settings: Record<string, unknown>): Promise<void> {
    host.send(ClientMessage.settings, settings);
    await waitFor(() =>
      Object.entries(settings).every(
        ([k, v]) => (room.state.settings as unknown as Record<string, unknown>)[k] === v,
      ),
    );
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
  }
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing value');
  return value;
}

function player(room: GameRoom, id: string): PlayerState {
  return must(room.state.players.get(id));
}

function players(room: GameRoom): PlayerState[] {
  return [...room.state.players.values()].sort((a, b) => a.joinOrder - b.joinOrder);
}

/** Plays the current round to its results with these deposits per player (join order). */
function finishRound(room: GameRoom, deposits: number[]): void {
  if (room.state.phase === 'countdown') room.advancePhase();
  expect(room.state.phase).toBe('playing');
  players(room).forEach((p, i) => (p.deposited = deposits[i] ?? 0));
  room.advancePhase();
  expect(room.state.phase).toBe('roundResults');
}

suite('map switch between rounds (integration, P3-1)', PORT, loadMapRegistry(), true, (h) => {
  it('defaults to both maps on a server that has both', async () => {
    const { room, host } = await h.lobby(1);
    expect(room.state.settings.maps).toBe('both');
    expect(host.state.settings.maps).toBe('both');
    expect(room.state.mapId).toBe('kespro');
  });

  it('rebuilds the systems on the next map and keeps the session', async () => {
    const { room, host, conns } = await h.lobby(3);
    await h.start(room, host, conns, { maps: 'both', roundsPerMap: 1, mode: 'timed' });
    expect(room.state.totalRounds).toBe(2);
    expect(room.currentMap.id).toBe('kespro');
    expect([...room.state.roundMaps]).toEqual(['kespro']);
    expect([...room.state.npcs.values()].some((n) => n.type === 'forklift')).toBe(true);
    const vansBefore = players(room).map((p) => p.van);

    // Round 1 on the first map: something to carry over, and things that must not.
    room.advancePhase();
    const [a] = players(room);
    must(a).hp = 1;
    finishRound(room, [5, 3, 0]);
    const session = players(room).map((p) => [p.sessionPoints, p.sessionItemPoints]);
    expect(session.every(([points]) => (points ?? 0) > 0)).toBe(true);

    room.advancePhase(); // countdown of round 2: the second map
    expect(room.state.phase).toBe('countdown');
    expect(room.state.round).toBe(2);
    expect(room.state.mapId).toBe('prisma');
    expect(room.currentMap).toBe(h.maps.get('prisma'));
    expect([...room.state.roundMaps]).toEqual(['kespro', 'prisma']);
    await waitFor(() => host.state.mapId === 'prisma' && host.state.roundMaps.length === 2);

    // Session totals and van slots carry over; everyone is fresh at their van on the new map.
    const prisma = room.currentMap.map;
    const half = playerHalfSize(config);
    players(room).forEach((p, i) => {
      expect([p.sessionPoints, p.sessionItemPoints]).toEqual(session[i]);
      expect(p.van).toBe(vansBefore[i]);
      expect({ x: p.x, y: p.y }).toEqual(vanSpawn(prisma, p.van, half));
      expect(p.hp).toBe(config.maxHp);
      expect(p.alive).toBe(true);
      expect(p.carrying).toBe(0);
      expect(p.deposited).toBe(0);
      expect(p.wanted).toBe(false);
    });

    // Every item and NPC now comes from the second map; nothing of the first round is left.
    const catalogue = room.currentMap.items;
    expect(room.state.items.size).toBeGreaterThan(0);
    for (const item of room.state.items.values()) expect(catalogue.get(item.itemId)).toBeDefined();
    const roster = new Set(room.currentMap.npcRoster);
    for (const npc of room.state.npcs.values()) expect(roster.has(npc.type as never)).toBe(true);
    expect(room.state.projectiles.size).toBe(0);
    expect(room.state.traps.size).toBe(0);
    expect(room.state.stockCarts.size).toBe(0);
    for (const van of room.state.vans.values()) expect(van.points).toBe(0);

    // The round plays on the second map; the podium ranks both rounds, and the lobby forgets the history.
    finishRound(room, [0, 0, 4]);
    expect(must(players(room)[2]).sessionItemPoints).toBe((session[2]?.[1] ?? 0) + 4);
    room.advancePhase();
    expect(room.state.phase).toBe('podium');
    expect([...room.state.roundMaps]).toEqual(['kespro', 'prisma']);
    room.advancePhase();
    expect(room.state.phase).toBe('lobby');
    expect([...room.state.roundMaps]).toEqual([]);
    expect(room.state.mapId).toBe('kespro');
    expect(room.state.items.size).toBe(0);
    expect(room.state.npcs.size).toBe(0);
  });

  it('starts the next session on the first map again', async () => {
    const { room, host, conns } = await h.lobby(2);
    await h.start(room, host, conns, { maps: 'both', roundsPerMap: 1 });
    finishRound(room, [1, 0]);
    room.advancePhase(); // second map
    finishRound(room, [1, 0]);
    room.advancePhase(); // podium
    room.advancePhase(); // lobby
    await h.start(room, host, conns, { mode: 'race' });
    expect(room.state.mapId).toBe('kespro');
    expect(room.currentMap.id).toBe('kespro');
    expect([...room.state.roundMaps]).toEqual(['kespro']);
    for (const p of players(room)) expect([p.sessionPoints, p.sessionItemPoints]).toEqual([0, 0]);
  });

  it('keeps team sides and team totals across the switch', async () => {
    const { room, host, conns } = await h.lobby(4);
    await h.start(room, host, conns, { maps: 'both', roundsPerMap: 1, teams: true });
    const teamOf = new Map(players(room).map((p) => [p.sessionId, p.team]));
    // On the first map the team vans are its first two slots.
    for (const p of players(room)) expect(p.van).toBe(p.team - 1);
    finishRound(room, [3, 0, 1, 0]);
    const totals = [...room.state.teams.values()].map((t) => [t.team, t.sessionPoints, t.sessionItemPoints]);
    expect(totals.some(([, points]) => (points ?? 0) > 0)).toBe(true);

    room.advancePhase();
    expect(room.state.mapId).toBe('prisma');
    for (const p of players(room)) {
      expect(p.team).toBe(teamOf.get(p.sessionId));
      // Teams share one van each (§4.3), at the new map's team slots: index 1 and 12 there (P1 review F3).
      expect(p.van).toBe([0, 11][p.team - 1]);
      expect({ x: p.x, y: p.y }).toEqual(vanSpawn(room.currentMap.map, p.van, playerHalfSize(config)));
    }
    expect([...room.state.teams.values()].map((t) => [t.team, t.sessionPoints, t.sessionItemPoints])).toEqual(
      totals,
    );
  });

  it('lets a late joiner play from the switch round', async () => {
    const { room, host, conns } = await h.lobby(2);
    await h.start(room, host, conns, { maps: 'both', roundsPerMap: 1 });
    room.advancePhase();
    const late = await h.join(room, 'Late');
    await waitFor(() => room.state.players.size === 3);
    expect(player(room, late.sessionId).spectator).toBe(true);
    finishRound(room, [2, 1, 0]);
    room.advancePhase();
    expect(room.state.mapId).toBe('prisma');
    const p = player(room, late.sessionId);
    expect(p.spectator).toBe(false);
    expect({ x: p.x, y: p.y }).toEqual(vanSpawn(room.currentMap.map, p.van, playerHalfSize(config)));
    expect(p.sessionPoints).toBe(0);
  });

  it('keeps a dropped player through the switch', async () => {
    const { room, host, conns } = await h.lobby(2);
    await h.start(room, host, conns, { maps: 'both', roundsPerMap: 1 });
    const guest = must(conns[1]);
    const id = guest.sessionId;
    const van = player(room, id).van;
    finishRound(room, [0, 2]);
    const points = player(room, id).sessionPoints;
    // An unexpected drop keeps the seat for the reconnect window, map switch or not.
    await guest.leave(false);
    await waitFor(() => room.state.players.get(id)?.connected === false);
    room.advancePhase();
    expect(room.state.mapId).toBe('prisma');
    const p = player(room, id);
    expect(p.van).toBe(van);
    expect(p.sessionPoints).toBe(points);
    expect({ x: p.x, y: p.y }).toEqual(vanSpawn(room.currentMap.map, p.van, playerHalfSize(config)));
  });
});

// The fixture second map has only FIXTURE_VAN_SLOTS van slots: a player whose slot is past the end
// takes the lowest free one there, everyone else keeps their slot number.
suite('map switch to a map with fewer van slots (P3-1)', PORT, twoMapRegistry(), false, (h) => {
  it('keeps the slots that exist and gives the rest the lowest free ones', async () => {
    const count = FIXTURE_VAN_SLOTS + 1;
    const { room, host, conns } = await h.lobby(count);
    await h.start(room, host, conns, { maps: 'both', roundsPerMap: 1 });
    const before = players(room).map((p) => p.van);
    expect(before).toEqual([...Array(count).keys()]);
    finishRound(room, []);
    room.advancePhase();
    expect(room.state.mapId).toBe('prisma');
    const after = players(room).map((p) => p.van);
    for (let i = 0; i < FIXTURE_VAN_SLOTS; i++) expect(after[i]).toBe(before[i]);
    // More players than slots: the extra one shares a slot (assignVans), never one past the end.
    expect(after[count - 1]).toBeLessThan(FIXTURE_VAN_SLOTS);
  });
});
