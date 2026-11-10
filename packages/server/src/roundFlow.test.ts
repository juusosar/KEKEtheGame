import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  defaultThemeId,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap } from './maps';
import { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own port: other integration files use 2568, 2571, 2572, 2574 and 2575, and test files run in parallel.
const PORT = 2576;

// The first test does a real pickup and deposit (three acked round trips) inside the round, so leave room.
const ROUND_SECONDS = 4;
const config = loadConfig({
  ...loadConfig(),
  // Short phases are never polled for: the test records every phase the room enters (M3 review F4).
  countdownSeconds: 0.05,
  timedRoundSeconds: ROUND_SECONDS,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
});
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
}

describe('GameRoom round flow and scoring (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  /** Every phase each room entered, with the clock it showed on entry, in order. */
  const entered = new Map<GameRoom, { phase: string; secondsLeft: number }[]>();

  beforeAll(async () => {
    // Record phases from the room itself instead of polling for them: a short phase such as the
    // countdown can begin and end between two polls when the test worker stalls (M3 review F4).
    const enterPhase = (GameRoom.prototype as unknown as { enterPhase: (phase: string) => void }).enterPhase;
    vi.spyOn(
      GameRoom.prototype as unknown as { enterPhase: (phase: string) => void },
      'enterPhase',
    ).mockImplementation(function (this: GameRoom, phase: string) {
      enterPhase.call(this, phase);
      const list = entered.get(this) ?? [];
      list.push({ phase: this.state.phase, secondsLeft: this.state.secondsLeft });
      entered.set(this, list);
    });
    // boot() ignores its port argument for a Server instance, so listen here instead.
    const server = createGameServer({ config, map });
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
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
    return { conn, me, seq: 0 };
  }

  async function join(room: GameRoom, nickname: string): Promise<Conn> {
    const conn = (await colyseus.sdk.join('game', { code: room.state.code, nickname })) as Conn;
    open.push(conn);
    await conn.waitForInitialState();
    return conn;
  }

  /** A room in 'playing' with `count` players. */
  async function playingRoom(
    count: number,
    settings: { teams?: boolean; roundsPerMap?: number } = {},
  ): Promise<{ room: GameRoom; players: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const conns = [host];
    for (let i = 1; i < count; i++) conns.push(await join(room, `G${i}`));
    if (settings.teams !== undefined || settings.roundsPerMap !== undefined) {
      host.send(ClientMessage.settings, settings);
      await waitFor(
        () =>
          room.state.settings.teams === (settings.teams ?? false) &&
          room.state.settings.roundsPerMap === (settings.roundsPerMap ?? 1),
      );
    }
    const players = conns.map((c) => wrap(room, c));
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, players };
  }

  /**
   * Ends 'playing' now with the given deposits. Set and advanced in one synchronous step, so no
   * simulation tick can overwrite `deposited` in between.
   */
  function endRound(room: GameRoom, players: Player[], deposits: number[]): void {
    expect(room.state.phase).toBe('playing');
    players.forEach((p, i) => (p.me.deposited = deposits[i] ?? 0));
    room.advancePhase();
    expect(room.state.phase).toBe('roundResults');
  }

  async function press(p: Player, buttons = 0): Promise<void> {
    const seq = ++p.seq;
    p.conn.send(ClientMessage.input, { seq, move: { x: 0, y: 0 }, aim: 0, buttons });
    await waitFor(() => p.me.ack === seq);
  }

  it('runs a 3-2-1 countdown, a timedRoundSeconds clock, and ranks the round when it hits 0', async () => {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const guest = await join(room, 'Guest');
    const [a, b] = [wrap(room, host), wrap(room, guest)];
    host.send(ClientMessage.ready, { ready: true });
    guest.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    expect(entered.get(room)).toEqual([
      { phase: 'countdown', secondsLeft: Math.ceil(config.countdownSeconds) },
      { phase: 'playing', secondsLeft: ROUND_SECONDS },
    ]);
    // The clock may already have ticked by the time we look: only check it is running down from the top.
    expect(room.state.secondsLeft).toBeGreaterThan(0);
    expect(room.state.secondsLeft).toBeLessThanOrEqual(ROUND_SECONDS);
    expect(a.me.place).toBe(0);

    // A real deposit: pick up the own target and walk it (teleport) to the own van.
    const target = room.state.items.get(String(a.me.target));
    if (!target) throw new Error('no target');
    a.me.x = target.x;
    a.me.y = target.y;
    await press(a, Button.Interact);
    await press(a);
    expect(a.me.carrying).not.toBe(0);
    const van = vanSpawn(map, a.me.van, playerHalfSize(config));
    a.me.x = van.x;
    a.me.y = van.y;
    await press(a);
    expect(a.me.deposited).toBeGreaterThan(0);
    const points = a.me.deposited;

    // Nobody ends the round: the clock does.
    await waitFor(() => room.state.phase === 'roundResults', (ROUND_SECONDS + 3) * 1000);
    expect(entered.get(room)?.map((e) => e.phase)).toEqual(['countdown', 'playing', 'roundResults']);
    expect(room.state.secondsLeft).toBe(config.roundResultsSeconds);
    expect([a.me.place, a.me.roundPoints, a.me.sessionPoints, a.me.sessionItemPoints]).toEqual([
      1,
      10,
      10,
      points,
    ]);
    expect([b.me.place, b.me.roundPoints, b.me.sessionPoints, b.me.sessionItemPoints]).toEqual([2, 7, 7, 0]);
    expect([a.me.sessionPlace, b.me.sessionPlace]).toEqual([1, 2]);

    // The clients see the results.
    await waitFor(() => guest.state.players.get(host.sessionId)?.roundPoints === 10);
    const seen = guest.state.players.get(guest.sessionId);
    expect([seen?.place, seen?.roundPoints, seen?.sessionPoints, seen?.sessionPlace]).toEqual([2, 7, 7, 2]);

    // Items stay frozen during the results: inputs no longer move anyone or deposit.
    const frozen = { x: b.me.x, y: b.me.y, ack: b.me.ack };
    b.conn.send(ClientMessage.input, { seq: ++b.seq, move: { x: 1, y: 0 }, aim: 0, buttons: 0 });
    await new Promise((r) => setTimeout(r, 150));
    expect({ x: b.me.x, y: b.me.y, ack: b.me.ack }).toEqual(frozen);
  }, 15_000);

  it('gives tied players the higher place and its points, and others placementPointsOther', async () => {
    const { room, players } = await playingRoom(6);
    endRound(room, players, [5, 5, 4, 3, 2, 1]);
    expect(players.map((p) => p.me.place)).toEqual([1, 1, 3, 4, 5, 6]);
    expect(players.map((p) => p.me.roundPoints)).toEqual([10, 10, 5, 3, 1, 1]);
    expect(players.map((p) => p.me.sessionPlace)).toEqual([1, 1, 3, 4, 5, 6]);
  });

  it('adds up a session over rounds, breaks a points tie on item points, and clears it in the lobby', async () => {
    const { room, players } = await playingRoom(2, { roundsPerMap: 2 });
    const [a, b] = players;
    if (!a || !b) throw new Error('no players');
    expect(room.state.totalRounds).toBe(2);

    endRound(room, players, [2, 1]);
    expect([a.me.sessionPoints, b.me.sessionPoints]).toEqual([10, 7]);

    room.advancePhase(); // countdown of round 2: round results cleared, session kept
    expect(room.state.round).toBe(2);
    expect([a.me.place, a.me.roundPoints, a.me.deposited]).toEqual([0, 0, 0]);
    expect([a.me.sessionPoints, a.me.sessionPlace]).toEqual([10, 1]);
    await waitFor(() => room.state.phase === 'playing');

    endRound(room, players, [0, 3]);
    expect([a.me.place, b.me.place]).toEqual([2, 1]);
    // 17 points each; b deposited 4 items points in the session against a's 2.
    expect([a.me.sessionPoints, b.me.sessionPoints]).toEqual([17, 17]);
    expect([a.me.sessionItemPoints, b.me.sessionItemPoints]).toEqual([2, 4]);
    expect([a.me.sessionPlace, b.me.sessionPlace]).toEqual([2, 1]);

    room.advancePhase(); // podium: final standings stay
    expect(room.state.phase).toBe('podium');
    expect([a.me.sessionPlace, b.me.sessionPlace]).toEqual([2, 1]);

    room.advancePhase(); // lobby
    expect(room.state.phase).toBe('lobby');
    for (const p of players) {
      expect([
        p.me.place,
        p.me.roundPoints,
        p.me.sessionPoints,
        p.me.sessionItemPoints,
        p.me.sessionPlace,
      ]).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('ranks teams on summed deposits; members share the team place and the team keeps a session total', async () => {
    const { room, players } = await playingRoom(4, { teams: true });
    expect([...room.state.teams.keys()].sort()).toEqual(['1', '2']);
    const deposits = players.map((p) => (p.me.team === 1 ? 2 : 1)); // team 1 4 points, team 2 2 points
    endRound(room, players, deposits);

    const team1 = room.state.teams.get('1');
    const team2 = room.state.teams.get('2');
    expect([team1?.place, team1?.itemPoints, team1?.roundPoints, team1?.sessionPoints]).toEqual([
      1, 4, 10, 10,
    ]);
    expect([team2?.place, team2?.itemPoints, team2?.roundPoints, team2?.sessionPoints]).toEqual([2, 2, 7, 7]);
    expect([team1?.sessionPlace, team2?.sessionPlace]).toEqual([1, 2]);
    for (const p of players) {
      const won = p.me.team === 1;
      expect([p.me.place, p.me.roundPoints, p.me.sessionPlace]).toEqual(won ? [1, 10, 1] : [2, 7, 2]);
      expect(p.me.sessionItemPoints).toBe(p.me.deposited);
    }

    room.advancePhase(); // podium
    room.advancePhase(); // lobby
    expect(room.state.teams.size).toBe(0);
  });

  it('does not rank a spectator, and ranks them from the next round with a fresh total', async () => {
    const { room, players } = await playingRoom(1, { roundsPerMap: 2 });
    const late = wrap(room, await join(room, 'Late'));
    expect(late.me.spectator).toBe(true);
    endRound(room, players, [1]);
    expect([late.me.place, late.me.roundPoints, late.me.sessionPlace]).toEqual([0, 0, 0]);
    expect(players[0]?.me.place).toBe(1);

    room.advancePhase(); // countdown: the spectator is admitted
    expect(late.me.spectator).toBe(false);
    await waitFor(() => room.state.phase === 'playing');
    endRound(room, [...players, late], [0, 1]);
    expect(late.me.place).toBe(1);
    expect([late.me.sessionPoints, players[0]?.me.sessionPoints]).toEqual([10, 17]);
    expect([late.me.sessionPlace, players[0]?.me.sessionPlace]).toEqual([2, 1]);
  });
});
