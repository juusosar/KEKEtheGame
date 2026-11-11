// Multi-map plumbing (Phase 2, P1-1): the room plays the map the host picked, built from the server's
// map registry at the countdown. Uses the fixture second map from testMaps.ts (id 'prisma').
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, loadConfig, playerHalfSize, vanSpawn, type GameRoomMetadata } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';
import { FIXTURE_VAN_SLOTS, twoMapRegistry } from './testMaps';

// Own port (Phase 2 plan: P1-1 2598); integration files run in parallel.
const PORT = 2598;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 60,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
});

type Conn = ClientRoom<GameRoom, GameState>;

describe('multi-map rooms (integration, P1-1)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];
  const maps = twoMapRegistry();

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

  /** A lobby room with a host and one guest. */
  async function lobby(): Promise<{ room: GameRoom; host: Conn; conns: Conn[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: 'Guest' })) as Conn;
    open.push(guest);
    await guest.waitForInitialState();
    return { room, host, conns: [host, guest] };
  }

  async function start(room: GameRoom, host: Conn, conns: Conn[]): Promise<void> {
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
  }

  it('plays the picked map: mapId, vans and NPC roster come from it', async () => {
    const { room, host, conns } = await lobby();
    expect(room.state.mapId).toBe('kespro');
    expect(room.currentMap.id).toBe('kespro');
    // The picker's list of loaded maps (P1-5) reaches the clients.
    expect([...host.state.loadedMaps]).toEqual(['kespro', 'prisma']);

    host.send(ClientMessage.settings, { maps: 'prisma' });
    await waitFor(() => room.state.settings.maps === 'prisma');
    // The lobby shows the session's first map; clients see it too.
    expect(room.state.mapId).toBe('prisma');
    await waitFor(() => host.state.mapId === 'prisma');
    await waitFor(() => (room.metadata as GameRoomMetadata | undefined)?.map === 'prisma');
    expect((room.metadata as GameRoomMetadata).maps).toBe('prisma');

    await start(room, host, conns);
    const fixture = maps.get('prisma');
    expect(room.currentMap).toBe(fixture);
    expect(room.state.mapId).toBe('prisma');
    expect(room.state.totalRounds).toBe(1);

    // Every player stands at their own van on the fixture map's slots.
    const half = playerHalfSize(config);
    for (const p of room.state.players.values()) {
      expect(p.van).toBeGreaterThanOrEqual(0);
      expect(p.van).toBeLessThan(FIXTURE_VAN_SLOTS);
      expect({ x: p.x, y: p.y }).toEqual(vanSpawn(fixture.map, p.van, half));
    }
    // The fixture map spawns stockers only: no guards, forklifts or butcher.
    const types = new Set([...room.state.npcs.values()].map((n) => n.type));
    expect(room.state.npcs.size).toBeGreaterThan(0);
    expect([...types]).toEqual(['stocker']);
  });

  it('keeps the default map unchanged when nothing is picked', async () => {
    const { room, host, conns } = await lobby();
    await start(room, host, conns);
    expect(room.currentMap.id).toBe('kespro');
    expect(room.state.mapId).toBe('kespro');
    const types = new Set([...room.state.npcs.values()].map((n) => n.type));
    expect([...types].sort()).toEqual(['butcher', 'forklift', 'security', 'stocker']);
  });

  it('counts rounds over both maps and starts on the first', async () => {
    const { room, host, conns } = await lobby();
    host.send(ClientMessage.settings, { maps: 'both', roundsPerMap: 2 });
    await waitFor(() => room.state.settings.maps === 'both' && room.state.settings.roundsPerMap === 2);
    expect(room.state.mapId).toBe('kespro');
    await start(room, host, conns);
    expect(room.state.totalRounds).toBe(4);
    expect(room.state.mapId).toBe('kespro');
    expect(room.currentMap.id).toBe('kespro');
  });

  it('goes back to the first map of the setting in the lobby', async () => {
    const { room, host, conns } = await lobby();
    host.send(ClientMessage.settings, { maps: 'prisma' });
    await waitFor(() => room.state.settings.maps === 'prisma');
    await start(room, host, conns);
    // Back to the lobby (debug endPhase is off here; the podium timer is long): drive the room directly.
    while (room.state.phase !== 'lobby') room.advancePhase();
    expect(room.state.mapId).toBe('prisma');
    expect(room.state.npcs.size).toBe(0);
    expect(room.state.items.size).toBe(0);
  });
});
