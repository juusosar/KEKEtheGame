// Host rules: the room setup menu's settings arrive with the create, the lobby can change them, and every
// round plays them on every map (they beat the map's own overrides for the keys the host set).
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, ServerMessage, loadConfig, mergeConfigOverride } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';

// Own port (host rules); integration files run in parallel.
const PORT = 2615;

// Long phases (the tests step with advancePhase()); the second map overrides the race quota.
const config = loadConfig({
  ...mergeConfigOverride(loadConfig(), {
    countdownSeconds: 60,
    timedRoundSeconds: 60,
    raceRoundSeconds: 70,
    roundResultsSeconds: 60,
    podiumSeconds: 60,
    raceQuota: 6,
  }),
  maps: { prisma: { raceQuota: 9, raceRoundSeconds: 100 } },
});

type Conn = ClientRoom<GameRoom, GameState>;

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const rulesOf = (state: GameState): Record<string, number> =>
  Object.fromEntries(state.settings.rules.entries());

describe('host rules (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    const server = createGameServer({ config, maps: loadMapRegistry(), npcs: false });
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

  async function create(settings?: Record<string, unknown>): Promise<{ room: GameRoom; host: Conn }> {
    const host = (await colyseus.sdk.create('game', {
      nickname: 'P0',
      ...(settings ? { settings } : {}),
    })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    return { room: colyseus.getRoomById<GameRoom>(host.roomId), host };
  }

  async function start(room: GameRoom, host: Conn): Promise<void> {
    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
  }

  function nextPlaying(room: GameRoom): void {
    while (room.state.phase !== 'playing') room.advancePhase();
  }

  it('applies the setup menu settings at create and plays the rules on both maps', async () => {
    const { room, host } = await create({
      mode: 'race',
      maps: 'both',
      roundsPerMap: 2,
      rules: { raceRoundSeconds: 120, raceQuota: 12, maxHp: 200, countdownSeconds: 5 },
    });
    expect(room.state.settings.mode).toBe('race');
    expect(room.state.settings.roundsPerMap).toBe(2);
    expect(rulesOf(room.state)).toEqual({
      raceRoundSeconds: 120,
      raceQuota: 12,
      maxHp: 200,
      countdownSeconds: 5,
    });
    // Clients see the rules and the lobby's quota straight away.
    await waitFor(() => host.state.settings.rules.get('raceQuota') === 12 && host.state.raceQuota === 12);

    await start(room, host);
    expect(room.state.secondsLeft).toBe(5);
    nextPlaying(room);
    expect(room.state.secondsLeft).toBe(120);
    expect([...room.state.players.values()][0]?.hp).toBe(200);

    // Rounds 3 and 4 are on the second map: its quota override loses to the host's.
    room.advancePhase();
    nextPlaying(room);
    room.advancePhase();
    nextPlaying(room);
    expect(room.state.mapId).toBe('prisma');
    expect(room.state.raceQuota).toBe(12);
    expect(room.state.secondsLeft).toBe(120);
    expect(room.currentConfig.raceQuota).toBe(12);
  });

  it("leaves a map's overrides alone for the rules the host did not set", async () => {
    const { room, host } = await create({ mode: 'race', maps: 'prisma', rules: { maxHp: 150 } });
    await start(room, host);
    nextPlaying(room);
    expect(room.state.raceQuota).toBe(9);
    expect(room.state.secondsLeft).toBe(100);
    expect(room.currentConfig.maxHp).toBe(150);
  });

  // The matchmaker reports a refused create as a generic error; the setup menu validates before sending.
  it('refuses a create with invalid settings', async () => {
    await expect(
      colyseus.sdk.create('game', { nickname: 'P0', settings: { rules: { raceQuota: 0 } } }),
    ).rejects.toThrow();
    await expect(
      colyseus.sdk.create('game', { nickname: 'P0', settings: { rules: { serverTickHz: 60 } } }),
    ).rejects.toThrow();
    await expect(
      colyseus.sdk.create('game', { nickname: 'P0', settings: { roundsPerMap: 99 } }),
    ).rejects.toThrow();
  });

  it('lets the host replace the rules in the lobby, drops unchanged values, and refuses everyone else', async () => {
    const { room, host } = await create();
    expect(rulesOf(room.state)).toEqual({});
    expect(room.currentConfig).toBe(config);

    host.send(ClientMessage.settings, { rules: { timedRoundSeconds: 90, raceQuota: config.raceQuota } });
    await waitFor(() => room.state.settings.rules.get('timedRoundSeconds') === 90);
    expect(rulesOf(room.state)).toEqual({ timedRoundSeconds: 90 });
    expect(room.currentConfig.timedRoundSeconds).toBe(90);

    const guest = (await colyseus.sdk.join('game', { nickname: 'P1', code: room.state.code })) as Conn;
    open.push(guest);
    await guest.waitForInitialState();
    const refusals: unknown[] = [];
    guest.onMessage(ServerMessage.lobbyError, (m: unknown) => refusals.push(m));
    guest.send(ClientMessage.settings, { rules: { timedRoundSeconds: 30 } });
    await waitFor(() => refusals.length === 1);
    expect(refusals[0]).toMatchObject({ code: 'not_host' });

    const hostRefusals: unknown[] = [];
    host.onMessage(ServerMessage.lobbyError, (m: unknown) => hostRefusals.push(m));
    host.send(ClientMessage.settings, { rules: { timedRoundSeconds: 31 } });
    await waitFor(() => hostRefusals.length === 1);
    expect(hostRefusals[0]).toMatchObject({ code: 'invalid_payload' });
    expect(rulesOf(room.state)).toEqual({ timedRoundSeconds: 90 });

    // An empty set goes back to the server's values.
    host.send(ClientMessage.settings, { rules: {} });
    await waitFor(() => room.state.settings.rules.size === 0);
    expect(room.currentConfig).toBe(config);

    // Not once a round is on.
    guest.send(ClientMessage.ready, { ready: true });
    await start(room, host);
    host.send(ClientMessage.settings, { rules: { timedRoundSeconds: 90 } });
    await waitFor(() => hostRefusals.length === 2);
    expect(hostRefusals[1]).toMatchObject({ code: 'wrong_phase' });
  });
});
