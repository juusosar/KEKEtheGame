// Per-map config overrides (Phase 2, P4-1): config.json `maps.<themeId>` overrides apply to every round on
// that map, from its countdown, and the other map keeps the top-level values. A session over both maps
// switches them at the map switch (P3-1).
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, loadConfig, mergeConfigOverride } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';

// Own port (P4-1); integration files run in parallel.
const PORT = 2610;

// Long top-level phases (the tests step the room with advancePhase()); the second map overrides a few
// round rules so the switch is visible.
const config = loadConfig({
  ...mergeConfigOverride(loadConfig(), {
    countdownSeconds: 60,
    timedRoundSeconds: 60,
    raceRoundSeconds: 70,
    roundResultsSeconds: 60,
    podiumSeconds: 60,
    raceQuota: 6,
    raceTeamQuotaPerMember: 0,
    jokeItemChance: 0.08,
  }),
  maps: { prisma: { timedRoundSeconds: 90, raceRoundSeconds: 100, raceQuota: 9, jokeItemChance: 0.5 } },
});

type Conn = ClientRoom<GameRoom, GameState>;

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('per-map config overrides (integration, P4-1)', () => {
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

  async function start(settings: Record<string, unknown>): Promise<{ room: GameRoom; host: Conn }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'P0' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    host.send(ClientMessage.settings, settings);
    await waitFor(() =>
      Object.entries(settings).every(
        ([k, v]) => (room.state.settings as unknown as Record<string, unknown>)[k] === v,
      ),
    );
    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
    return { room, host };
  }

  /** From results (or the countdown of round 1) to the next round's 'playing'. */
  function nextPlaying(room: GameRoom): void {
    while (room.state.phase !== 'playing') room.advancePhase();
  }

  it('plays the first map on the top-level values and the second on its overrides', async () => {
    const { room, host } = await start({ maps: 'both', roundsPerMap: 1, mode: 'timed' });
    expect(room.state.mapId).toBe('kespro');
    expect(room.currentConfig).toBe(config);
    nextPlaying(room);
    expect(room.state.secondsLeft).toBe(60);
    expect(room.state.raceQuota).toBe(6);

    room.advancePhase(); // results
    nextPlaying(room); // round 2 on the second map
    expect(room.state.mapId).toBe('prisma');
    expect(room.currentConfig.timedRoundSeconds).toBe(90);
    expect(room.currentConfig.jokeItemChance).toBe(0.5);
    // Keys a map does not set, and session-wide keys, stay as they were.
    expect(room.currentConfig.countdownSeconds).toBe(60);
    expect(room.currentConfig.serverTickHz).toBe(config.serverTickHz);
    expect(room.state.secondsLeft).toBe(90);
    expect(room.state.raceQuota).toBe(9);
    await waitFor(() => host.state.secondsLeft === 90 && host.state.raceQuota === 9);

    // The next session starts on the first map again, with its own values.
    room.advancePhase(); // results
    room.advancePhase(); // podium
    room.advancePhase(); // lobby
    expect(room.state.phase).toBe('lobby');
    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
    expect(room.state.mapId).toBe('kespro');
    expect(room.currentConfig).toBe(config);
    expect(room.state.raceQuota).toBe(6);
  });

  it("gives the map systems the map's values: the race round timer and van quota", async () => {
    const { room } = await start({ maps: 'prisma', mode: 'race' });
    expect(room.state.mapId).toBe('prisma');
    nextPlaying(room);
    expect(room.state.secondsLeft).toBe(100);
    expect(room.state.raceQuota).toBe(9);
    const vans = [...room.state.vans.values()].filter((v) => v.quota > 0);
    expect(vans.length).toBeGreaterThan(0);
    for (const van of vans) expect(van.quota).toBe(9);
  });
});
