import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  ClientMessage,
  ServerMessage,
  isRoomCode,
  loadConfig,
  type GameRoomMetadata,
  type LobbyErrorMessage,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';

// Short phases so the full round cycle runs in well under a second.
const config = loadConfig({
  ...loadConfig(),
  maxPlayersPerRoom: 3,
  countdownSeconds: 0.05,
  timedRoundSeconds: 0.05,
  raceRoundSeconds: 0.05,
  roundResultsSeconds: 0.05,
  podiumSeconds: 0.05,
});

type Conn = ClientRoom<GameRoom, GameState>;

describe('GameRoom (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    // Own port: hello.test.ts uses the default test port 2568 and test files run in parallel.
    // boot() ignores its port argument for a Server instance, so listen here instead.
    const server = createGameServer({ config });
    await server.listen(2571);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  async function create(options: Record<string, unknown> = {}): Promise<{ client: Conn; room: GameRoom }> {
    const client = (await colyseus.sdk.create('game', { nickname: 'Host', ...options })) as Conn;
    open.push(client);
    const room = colyseus.getRoomById<GameRoom>(client.roomId);
    await client.waitForInitialState();
    return { client, room };
  }

  async function join(code: string | undefined, options: Record<string, unknown> = {}): Promise<Conn> {
    const client = (await colyseus.sdk.join('game', { code, ...options })) as Conn;
    open.push(client);
    await client.waitForInitialState();
    return client;
  }

  async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  function nextError(client: Conn): Promise<LobbyErrorMessage> {
    return new Promise((resolve) => client.onMessage(ServerMessage.lobbyError, resolve));
  }

  it('creates a room with a 4-letter code in state and metadata, and a sanitised host profile', async () => {
    const { client, room } = await create({
      nickname: '  Juuso  ',
      color: '#e53935',
      hat: 'chef',
      code: 'ZZZZ',
    });
    expect(isRoomCode(room.state.code)).toBe(true);
    expect(room.state.code).not.toBe('ZZZZ');
    expect(client.state.code).toBe(room.state.code);
    expect(room.state.hostId).toBe(client.sessionId);
    const me = room.state.players.get(client.sessionId);
    expect(me?.nickname).toBe('Juuso');
    expect(me?.color).toBe('#E53935');
    expect(me?.hat).toBe('chef');
    await waitFor(() => (room.metadata as GameRoomMetadata | undefined)?.hostName === 'Juuso');
    expect(room.metadata).toEqual({
      code: room.state.code,
      hostName: 'Juuso',
      mode: 'timed',
      phase: 'lobby',
    });
    expect(room.maxClients).toBe(3);
  });

  it('joins by code and rejects a wrong or missing code', async () => {
    const a = await create();
    const b = await create();
    // Matching is exact; the client normalises typed codes with normalizeRoomCode first.
    const guest = await join(a.room.state.code, { nickname: 'Guest' });
    expect(guest.roomId).toBe(a.room.roomId);
    expect(a.room.state.players.size).toBe(2);
    expect(b.room.state.code).not.toBe(a.room.state.code);

    await expect(colyseus.sdk.join('game', { code: 'QQQQ' })).rejects.toThrow();
    await expect(colyseus.sdk.joinById(a.room.roomId, {})).rejects.toThrow(/code/);
  });

  it('never gives a codeless join a seat, even in a brand-new room (M2 review F3)', async () => {
    // Before the creator connects: the room is locked, so a join without a code finds nothing.
    const reservation = await colyseus.sdk.http.post('matchmake/create/game', { body: { nickname: 'Host' } });
    expect(reservation).toBeDefined();
    await expect(colyseus.sdk.join('game', {})).rejects.toThrow();
    // After the creator is in: the room is open for codes only.
    const { room } = await create();
    await expect(colyseus.sdk.join('game', {})).rejects.toThrow(/code/);
    expect(room.state.players.size).toBe(1);
  });

  it('refuses joins beyond maxPlayersPerRoom', async () => {
    const { room } = await create();
    await join(room.state.code);
    await join(room.state.code);
    await expect(colyseus.sdk.join('game', { code: room.state.code })).rejects.toThrow();
  });

  it('lists game rooms in the LobbyRoom with their metadata', async () => {
    const { room } = await create({ nickname: 'Lister' });
    await waitFor(() => (room.metadata as GameRoomMetadata | undefined)?.hostName === 'Lister');
    const lobby = await colyseus.sdk.joinOrCreate('lobby');
    const rooms = await new Promise<
      Array<{ roomId: string; metadata: GameRoomMetadata; maxClients: number }>
    >((resolve) => lobby.onMessage('rooms', resolve));
    const listed = rooms.find((r) => r.roomId === room.roomId);
    expect(listed?.metadata.code).toBe(room.state.code);
    expect(listed?.maxClients).toBe(3);
    await lobby.leave();
  });

  it('passes the host role to the longest-connected player', async () => {
    const { client: host, room } = await create();
    const second = await join(room.state.code, { nickname: 'Second' });
    const third = await join(room.state.code, { nickname: 'Third' });
    await host.leave();
    await waitFor(() => room.state.hostId === second.sessionId);
    await waitFor(() => (room.metadata as GameRoomMetadata).hostName === 'Second');
    await second.leave();
    await waitFor(() => room.state.hostId === third.sessionId);
  });

  it('toggles ready and only lets the host change settings', async () => {
    const { client: host, room } = await create();
    const guest = await join(room.state.code);

    guest.send(ClientMessage.ready, { ready: true });
    await waitFor(() => room.state.players.get(guest.sessionId)?.ready === true);

    const refused = nextError(guest);
    guest.send(ClientMessage.settings, { mode: 'race' });
    expect(await refused).toEqual({ code: 'not_host', request: 'settings' });

    const invalid = nextError(host);
    host.send(ClientMessage.settings, { roundsPerMap: 9 });
    expect(await invalid).toEqual({ code: 'invalid_payload', request: 'settings' });

    host.send(ClientMessage.settings, { mode: 'race', roundsPerMap: 3 });
    await waitFor(() => room.state.settings.mode === 'race' && room.state.settings.roundsPerMap === 3);
    await waitFor(() => (room.metadata as GameRoomMetadata).mode === 'race');
  });

  it('balances teams when turned on, shuffles on request and clears them when off', async () => {
    const { client: host, room } = await create();
    await join(room.state.code);
    await join(room.state.code);

    const off = nextError(host);
    host.send(ClientMessage.shuffleTeams);
    expect((await off).code).toBe('teams_off');

    host.send(ClientMessage.settings, { teams: true });
    await waitFor(() => room.state.settings.teams);
    const teams = () => [...room.state.players.values()].map((p) => p.team).sort();
    expect(teams()).toEqual([1, 1, 2]);

    host.send(ClientMessage.shuffleTeams);
    await new Promise((r) => setTimeout(r, 30));
    expect(teams()).toEqual([1, 1, 2]);

    host.send(ClientMessage.settings, { teams: false });
    await waitFor(() => teams().every((t) => t === 0));
  });

  it('starts only when everyone is ready, then cycles every phase back to the lobby', async () => {
    const { client: host, room } = await create();
    const guest = await join(room.state.code);
    host.send(ClientMessage.settings, { roundsPerMap: 2 });
    host.send(ClientMessage.ready, { ready: true });

    const notReady = nextError(host);
    host.send(ClientMessage.start);
    expect(await notReady).toEqual({ code: 'not_ready', request: 'start' });

    guest.send(ClientMessage.ready, { ready: true });
    await waitFor(() => room.state.players.get(guest.sessionId)?.ready === true);

    const phases: string[] = [];
    const record = () => {
      const tag = `${room.state.phase}:${room.state.round}`;
      if (phases[phases.length - 1] !== tag) phases.push(tag);
    };
    record();
    const timer = setInterval(record, 2);
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
    expect(room.state.totalRounds).toBe(2);

    const lateWrong = nextError(guest);
    guest.send(ClientMessage.ready, { ready: false });
    expect((await lateWrong).code).toBe('wrong_phase');

    await waitFor(() => phases.length > 1 && phases[phases.length - 1] === 'lobby:0', 3000);
    clearInterval(timer);
    expect(phases).toEqual([
      'lobby:0',
      'countdown:1',
      'playing:1',
      'roundResults:1',
      'countdown:2',
      'playing:2',
      'roundResults:2',
      'podium:2',
      'lobby:0',
    ]);
    expect([...room.state.players.values()].every((p) => !p.ready)).toBe(true);
    await waitFor(() => (room.metadata as GameRoomMetadata).phase === 'lobby');
  });

  it('makes late joiners spectators until the next round starts', async () => {
    const { client: host, room } = await create();
    host.send(ClientMessage.settings, { roundsPerMap: 2 });
    host.send(ClientMessage.ready, { ready: true });
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    room.clock.clear(); // freeze the phase timers so the test controls the clock
    const late = await join(room.state.code);
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(true);
    room.advancePhase(); // → roundResults
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(true);
    room.advancePhase(); // → countdown of round 2
    expect(room.state.round).toBe(2);
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(false);
  });
});
