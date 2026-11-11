import { performance } from 'node:perf_hooks';
import { matchMaker, type Server } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import {
  ClientMessage,
  defaultThemeId,
  loadConfig,
  type GameConfig,
  type GameMode,
  type MapModel,
  type ThemeId,
} from '@keke/shared';
import { createGameServer } from '../app';
import { loadMapRegistry } from '../maps';
import type { GameRoom } from '../rooms/GameRoom';
import type { GameState } from '../schema/GameState';
import { PERSONAS, SoakBot, mulberry32, type BotStats, type SoakConn } from './bot';
import { diffStates } from './diff';

// M7-4: the 8-player soak. One in-process game server, N simulated players (SoakBot) on real WebSocket
// connections, and a list of multi-round sessions played back to back in the same room: e.g. Timed,
// Race, Timed with teams, Race with teams, 3 rounds each. While they play it watches for
// - errors: anything the server or the client SDK logs with console.error/warn, uncaught exceptions and
//   rejections, room errors and unexpected leaves on the client side (schema decode / patch problems
//   surface here);
// - desync: now and then it pauses the simulation, lets the patches drain, and compares every client's
//   decoded state with the server's state field by field (float32 fields with a tolerance);
// - session flow: the podium has every player placed and the lobby afterwards is clean (M7-1 handoff);
// - growth: the simulation tick and patch encode times per round, and heap/RSS after each session.

export interface SessionPlan {
  readonly mode: GameMode;
  readonly teams: boolean;
  readonly rounds: number;
  /** The map the session plays on (Phase 2, P1-6). Default: the first map. */
  readonly map?: ThemeId;
}

/** `timed`, `race+teams@prisma`: the CLI's and the log's name for a session plan. */
export function planName(plan: SessionPlan): string {
  return `${plan.mode}${plan.teams ? '+teams' : ''}${plan.map && plan.map !== defaultThemeId ? `@${plan.map}` : ''}`;
}

export interface SoakOptions {
  readonly port: number;
  readonly players: number;
  readonly sessions: readonly SessionPlan[];
  /** Merged over config.json. The defaults shorten the round timers so a soak takes minutes, not an hour. */
  readonly config?: Partial<GameConfig>;
  readonly seed?: number;
  /** Seconds between desync checks while 'playing' (each pauses the simulation for about 0.4 s). */
  readonly desyncEverySeconds?: number;
  /** Folder with the built client, so browser players can load the game from this server. */
  readonly clientDist?: string;
  /**
   * Called once the room exists (lobby, before the first session) with its code and the server URL, for
   * extra players outside this process (browser pages). Resolves when they have joined; the soak waits
   * for every non-spectator to be ready before each start, so they must ready up themselves.
   */
  readonly extraPlayers?: (code: string, url: string) => Promise<void>;
  /** Called before each session's start, after the settings are in, e.g. to ready browser players. */
  readonly beforeStart?: () => Promise<void>;
  /** Called when the sessions are over, before the bots leave and the server stops. */
  readonly stopExtraPlayers?: () => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface TimingStats {
  count: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface RoundReport {
  round: number;
  playingSeconds: number;
  ticks: TimingStats;
  patches: TimingStats;
  /** Item points deposited this round, all players. */
  deposited: number;
  /** Race: the deliverer's nickname, '' at the time cap or in Timed. */
  raceWinner: string;
  players: number;
  npcs: number;
  items: number;
}

export interface SessionReport {
  plan: SessionPlan;
  rounds: RoundReport[];
  /** Problems with the podium or the lobby afterwards; empty when the session ended cleanly. */
  flowProblems: string[];
  standings: { nickname: string; team: number; sessionPlace: number; sessionPoints: number }[];
  memory: { heapUsedMb: number; rssMb: number };
  seconds: number;
}

export interface SoakReport {
  ok: boolean;
  failures: string[];
  players: number;
  sessions: SessionReport[];
  errors: string[];
  desyncChecks: number;
  desyncs: string[];
  events: Record<string, number>;
  bots: BotStats & { personas: Record<string, number> };
  memoryStart: { heapUsedMb: number; rssMb: number };
  seconds: number;
}

/** Short timers for a soak: a 3-round session in about 2 to 3 minutes (Race ends earlier on a delivery). */
export const SOAK_CONFIG: Partial<GameConfig> = {
  countdownSeconds: 1,
  timedRoundSeconds: 45,
  raceRoundSeconds: 75,
  roundResultsSeconds: 2,
  podiumSeconds: 2,
  // A lower quota, so race rounds see packing, box theft and deliveries, not only the time cap.
  raceQuota: 2,
  raceTeamQuotaPerMember: 1,
};

export const DEFAULT_SESSIONS: readonly SessionPlan[] = [
  { mode: 'timed', teams: false, rounds: 3 },
  { mode: 'race', teams: false, rounds: 3 },
  { mode: 'timed', teams: true, rounds: 3 },
  { mode: 'race', teams: true, rounds: 3 },
  // P1-6: the second map, Timed and Race.
  { mode: 'timed', teams: false, rounds: 3, map: 'prisma' },
  { mode: 'race', teams: false, rounds: 3, map: 'prisma' },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`soak: timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** Resolves once the client has decoded its first full state (it holds its own player). */
async function initialState(conn: SoakConn): Promise<void> {
  await waitFor(() => conn.state?.players?.get(conn.sessionId) !== undefined, 5000, 'the first state');
}

function stats(samples: readonly number[]): TimingStats {
  if (samples.length === 0) return { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    count: sorted.length,
    meanMs: round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p95Ms: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
  };
}

function memory(): { heapUsedMb: number; rssMb: number } {
  (globalThis as { gc?: () => void }).gc?.();
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
  return { heapUsedMb: mb(m.heapUsed), rssMb: mb(m.rss) };
}

/** Collects console errors and warnings, uncaught exceptions and rejections while the soak runs. */
function captureErrors(errors: string[]): () => void {
  const original = { error: console.error, warn: console.warn };
  const record =
    (level: 'error' | 'warn') =>
    (...args: unknown[]): void => {
      const text = args
        .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : String(a)))
        .join(' ');
      errors.push(`console.${level}: ${text}`);
      original[level](...args);
    };
  console.error = record('error');
  console.warn = record('warn');
  const onException = (e: unknown) => errors.push(`uncaughtException: ${(e as Error)?.stack ?? String(e)}`);
  const onRejection = (e: unknown) => errors.push(`unhandledRejection: ${(e as Error)?.stack ?? String(e)}`);
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onRejection);
  return () => {
    console.error = original.error;
    console.warn = original.warn;
    process.off('uncaughtException', onException);
    process.off('unhandledRejection', onRejection);
  };
}

/** Times the room's simulation tick and patch broadcast, and lets the soak pause the simulation. */
class RoomProbe {
  ticks: number[] = [];
  patches: number[] = [];
  frozen = false;

  constructor(room: GameRoom) {
    const tick = room.tick.bind(room);
    room.tick = () => {
      if (this.frozen) return;
      const t0 = performance.now();
      tick();
      this.ticks.push(performance.now() - t0);
    };
    const broadcastPatch = room.broadcastPatch.bind(room);
    room.broadcastPatch = () => {
      const t0 = performance.now();
      const changed = broadcastPatch();
      this.patches.push(performance.now() - t0);
      return changed;
    };
  }

  take(): { ticks: TimingStats; patches: TimingStats } {
    const out = { ticks: stats(this.ticks), patches: stats(this.patches) };
    this.ticks = [];
    this.patches = [];
    return out;
  }
}

export async function runSoak(options: SoakOptions): Promise<SoakReport> {
  const log = options.log ?? (() => {});
  const config = loadConfig({ ...loadConfig(), ...SOAK_CONFIG, ...options.config });
  const maps = loadMapRegistry();
  const map: MapModel = maps.get(options.sessions[0]?.map ?? defaultThemeId).map;
  const random = mulberry32(options.seed ?? 7);
  const errors: string[] = [];
  const desyncs: string[] = [];
  const events: Record<string, number> = {};
  const sessions: SessionReport[] = [];
  const started = performance.now();
  let desyncChecks = 0;

  const restoreConsole = captureErrors(errors);
  const memoryStart = memory();
  const server: Server = createGameServer({
    config,
    maps,
    ...(options.clientDist ? { clientDist: options.clientDist } : {}),
  });
  await server.listen(options.port);
  const url = `http://localhost:${options.port}`;
  const client = new Client(url);
  const conns: SoakConn[] = [];
  const bots: SoakBot[] = [];
  let pump: ReturnType<typeof setInterval> | undefined;
  let finished = false;

  try {
    // --- Join: the first bot hosts, the others join by code. -------------------------------------
    const host = (await client.create('game', { nickname: 'Bot 1' })) as unknown as SoakConn;
    conns.push(host);
    await initialState(host);
    const room = matchMaker.getLocalRoomById(host.roomId) as unknown as GameRoom;
    const probe = new RoomProbe(room);
    for (let i = 1; i < options.players; i++) {
      const conn = (await client.join('game', {
        code: room.state.code,
        nickname: `Bot ${i + 1}`,
      })) as unknown as SoakConn;
      conns.push(conn);
      await initialState(conn);
    }
    conns.forEach((conn, i) => {
      // A dropped socket would hide errors behind reconnect attempts; the soak wants to see them.
      conn.reconnection.enabled = false;
      conn.onError((code, message) => errors.push(`client ${i + 1} room error ${code}: ${message ?? ''}`));
      conn.onLeave((code) => {
        if (!finished) errors.push(`client ${i + 1} left unexpectedly (code ${code})`);
      });
      // Count every broadcast once (from the host's copy).
      conn.onMessage('*', (type, payload) => {
        if (i !== 0) return;
        const kind = (payload as { kind?: unknown } | null)?.kind;
        events[String(type)] = (events[String(type)] ?? 0) + 1;
        if (typeof kind === 'string')
          events[`${String(type)}:${kind}`] = (events[`${String(type)}:${kind}`] ?? 0) + 1;
      });
      const persona = PERSONAS[i % PERSONAS.length] ?? 'runner';
      bots.push(new SoakBot(conn, persona, map, config, random));
    });
    log(`soak: ${options.players} bots in room ${room.state.code} on ${url}`);
    if (options.extraPlayers) await options.extraPlayers(room.state.code, url);

    // --- Bots send one frame per fixed input step, on average exactly inputHz (never faster). ------
    const stepMs = 1000 / config.inputHz;
    const pumpStart = performance.now();
    let stepsDone = 0;
    pump = setInterval(() => {
      const due = Math.floor((performance.now() - pumpStart) / stepMs);
      // After a stall send at most 3 steps' worth, like a client catching up; skip the rest.
      if (due - stepsDone > 3) stepsDone = due - 3;
      while (stepsDone < due) {
        for (const bot of bots) bot.frame();
        stepsDone++;
      }
    }, 5);

    // --- Desync check: pause the simulation, let the patches drain, compare every client. ----------
    const checkSync = async (label: string): Promise<void> => {
      probe.frozen = true;
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          await sleep(250);
          const server1 = JSON.stringify(room.state.toJSON());
          await sleep(150);
          const serverJson = room.state.toJSON() as Record<string, unknown>;
          // A phase timer fired meanwhile: the patches are still in flight, try again.
          if (JSON.stringify(serverJson) !== server1) continue;
          desyncChecks++;
          conns.forEach((conn, i) => {
            const diffs = diffStates(serverJson, conn.state.toJSON() as Record<string, unknown>);
            if (diffs.length > 0) desyncs.push(`${label}, client ${i + 1}: ${diffs.slice(0, 5).join('; ')}`);
          });
          return;
        }
        desyncs.push(`${label}: the server state never settled for a check`);
      } finally {
        probe.frozen = false;
      }
    };

    // --- Sessions, back to back in the same room. --------------------------------------------------
    for (const [index, plan] of options.sessions.entries()) {
      const label = `session ${index + 1} (${planName(plan)})`;
      const sessionStart = performance.now();
      const mapId = plan.map ?? defaultThemeId;
      log(`${label}: ${plan.rounds} rounds`);
      host.send(ClientMessage.settings, {
        mode: plan.mode,
        teams: plan.teams,
        roundsPerMap: plan.rounds,
        maps: mapId,
      });
      for (const bot of bots) bot.useMap(maps.get(mapId).map);
      await waitFor(
        () =>
          room.state.settings.mode === plan.mode &&
          room.state.settings.teams === plan.teams &&
          room.state.settings.roundsPerMap === plan.rounds &&
          room.state.settings.maps === mapId,
        5000,
        `${label} settings`,
      );
      for (const conn of conns) conn.send(ClientMessage.ready, { ready: true });
      if (options.beforeStart) await options.beforeStart();
      await waitFor(
        () => [...room.state.players.values()].every((p) => p.spectator || p.ready),
        30_000,
        `${label} everyone ready`,
      );
      host.send(ClientMessage.start);
      await waitFor(() => room.state.phase === 'countdown', 5000, `${label} start`);
      if (room.state.totalRounds !== plan.rounds) {
        errors.push(`${label}: totalRounds is ${room.state.totalRounds}, expected ${plan.rounds}`);
      }

      const rounds: RoundReport[] = [];
      const flowProblems: string[] = [];
      let standings: SessionReport['standings'] = [];
      const roundSeconds = plan.mode === 'race' ? config.raceRoundSeconds : config.timedRoundSeconds;
      const sessionLimitMs =
        (plan.rounds * (config.countdownSeconds + roundSeconds + config.roundResultsSeconds + 10) +
          config.podiumSeconds +
          30) *
        1000;
      const sessionUntil = Date.now() + sessionLimitMs;
      let lastPhase = '';
      let playingSince = 0;
      let nextCheck = 0;
      while (true) {
        if (Date.now() > sessionUntil) throw new Error(`soak: ${label} did not finish in time`);
        const phase = room.state.phase;
        if (phase !== lastPhase) {
          if (phase === 'playing') {
            probe.take(); // countdown ticks do not count
            playingSince = performance.now();
            nextCheck = performance.now() + (options.desyncEverySeconds ?? 8) * 1000;
          } else if (phase === 'roundResults') {
            const players = [...room.state.players.values()];
            const winner = room.state.raceWinner ? room.state.players.get(room.state.raceWinner) : undefined;
            rounds.push({
              round: room.state.round,
              playingSeconds: Math.round((performance.now() - playingSince) / 100) / 10,
              ...probe.take(),
              deposited: players.reduce((s, p) => s + p.deposited, 0),
              raceWinner: winner?.nickname ?? '',
              players: players.filter((p) => !p.spectator).length,
              npcs: room.state.npcs.size,
              items: room.state.items.size,
            });
            log(
              `${label} round ${room.state.round}: ${rounds.at(-1)?.deposited} points deposited` +
                (winner ? `, delivered by ${winner.nickname}` : ''),
            );
            await checkSync(`${label} round ${room.state.round} results`);
          } else if (phase === 'podium') {
            for (const p of room.state.players.values()) {
              if (!p.spectator && p.sessionPlace < 1) flowProblems.push(`podium: ${p.nickname} has no place`);
            }
            if (plan.teams) {
              for (const t of room.state.teams.values()) {
                if (t.sessionPlace < 1) flowProblems.push(`podium: team ${t.team} has no place`);
              }
            }
            standings = [...room.state.players.values()]
              .filter((p) => !p.spectator)
              .map((p) => ({
                nickname: p.nickname,
                team: p.team,
                sessionPlace: p.sessionPlace,
                sessionPoints: p.sessionPoints,
              }))
              .sort((a, b) => a.sessionPlace - b.sessionPlace);
            await checkSync(`${label} podium`);
          } else if (phase === 'lobby') {
            break;
          }
          lastPhase = phase;
        }
        if (phase === 'playing' && performance.now() >= nextCheck) {
          await checkSync(`${label} round ${room.state.round} playing`);
          nextCheck = performance.now() + (options.desyncEverySeconds ?? 8) * 1000;
        }
        await sleep(20);
      }

      // Back in the lobby: the session is over and everything is reset (M7-1 handoff).
      await checkSync(`${label} lobby`);
      flowProblems.push(...lobbyProblems(room.state));
      if (rounds.length !== plan.rounds)
        flowProblems.push(`played ${rounds.length} rounds, not ${plan.rounds}`);
      const report: SessionReport = {
        plan,
        rounds,
        flowProblems,
        standings,
        memory: memory(),
        seconds: Math.round((performance.now() - sessionStart) / 100) / 10,
      };
      sessions.push(report);
      log(
        `${label}: done in ${report.seconds} s, heap ${report.memory.heapUsedMb} MB` +
          (flowProblems.length ? `, problems: ${flowProblems.join('; ')}` : ''),
      );
    }
    finished = true;
  } finally {
    if (pump) clearInterval(pump);
    finished = true;
    await options.stopExtraPlayers?.().catch(() => {});
    await Promise.all(
      conns.map((c) => (c.connection.isOpen ? c.leave().catch(() => {}) : Promise.resolve())),
    );
    await server.gracefullyShutdown(false).catch(() => {});
    restoreConsole();
  }

  const botTotals: BotStats & { personas: Record<string, number> } = {
    framesSent: 0,
    pickupsTried: 0,
    attacksTried: 0,
    dropsTried: 0,
    wanders: 0,
    personas: {},
  };
  for (const bot of bots) {
    for (const key of ['framesSent', 'pickupsTried', 'attacksTried', 'dropsTried', 'wanders'] as const) {
      botTotals[key] += bot.stats[key];
    }
    botTotals.personas[bot.persona] = (botTotals.personas[bot.persona] ?? 0) + 1;
  }

  const report: SoakReport = {
    ok: false,
    failures: [],
    players: options.players,
    sessions,
    errors,
    desyncChecks,
    desyncs,
    events,
    bots: botTotals,
    memoryStart,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
  report.failures = judge(report, options.sessions);
  report.ok = report.failures.length === 0;
  return report;
}

/** The lobby after a session: no session fields left, no round objects left (M7-1 handoff). */
function lobbyProblems(state: GameState): string[] {
  const problems: string[] = [];
  if (state.round !== 0 || state.totalRounds !== 0) {
    problems.push(`lobby: round ${state.round} of ${state.totalRounds}, expected 0 of 0`);
  }
  for (const p of state.players.values()) {
    const left = (
      ['sessionPoints', 'sessionItemPoints', 'sessionPlace', 'place', 'roundPoints', 'deposited'] as const
    ).filter((k) => p[k] !== 0);
    if (left.length > 0) problems.push(`lobby: ${p.nickname} still has ${left.join(', ')}`);
    if (p.ready) problems.push(`lobby: ${p.nickname} is still ready`);
  }
  for (const key of ['items', 'projectiles', 'traps'] as const) {
    if (state[key].size > 0) problems.push(`lobby: ${state[key].size} ${key} left`);
  }
  if (state.raceWinner !== '') problems.push('lobby: raceWinner not cleared');
  return problems;
}

/** Pass/fail rules for a soak report. */
export function judge(report: SoakReport, plans: readonly SessionPlan[]): string[] {
  const failures: string[] = [];
  if (report.errors.length > 0) failures.push(`${report.errors.length} errors logged`);
  if (report.desyncs.length > 0) failures.push(`${report.desyncs.length} desyncs`);
  if (report.desyncChecks === 0) failures.push('no desync check ran');
  if (report.sessions.length !== plans.length) {
    failures.push(`${report.sessions.length} of ${plans.length} sessions finished`);
  }
  for (const [i, s] of report.sessions.entries()) {
    for (const p of s.flowProblems) failures.push(`session ${i + 1}: ${p}`);
  }
  // The bots must have actually played: picked up, deposited, fought, knocked out, been Wanted.
  const need = ['pickup', 'deposit', 'hit', 'ko', 'wanted', 'npcHit'];
  if (plans.some((p) => p.mode === 'race')) need.push('boxPacked', 'delivery');
  for (const type of need) if (!report.events[type]) failures.push(`no '${type}' event in the whole soak`);
  // Growth: the tick of the last round of the run may not be much slower than the first one's.
  const rounds = report.sessions.flatMap((s) => s.rounds);
  const first = rounds[0]?.ticks.meanMs ?? 0;
  const last = rounds.at(-1)?.ticks.meanMs ?? 0;
  if (rounds.length >= 2 && last > first * 2 + 0.5) {
    failures.push(`tick time grew from ${first} ms to ${last} ms mean`);
  }
  // The tick budget is 50 ms at 20 Hz. A single slow tick is usually the machine (GC, other processes),
  // so the rule is on the 95th percentile, with a generous cap on the worst one.
  const p95 = Math.max(0, ...rounds.map((r) => r.ticks.p95Ms));
  if (p95 > 20) failures.push(`tick p95 reached ${p95} ms`);
  const maxTick = Math.max(0, ...rounds.map((r) => r.ticks.maxMs));
  if (maxTick > 250) failures.push(`a tick took ${maxTick} ms`);
  // Memory: heap after the last session vs after the first (both after a full GC when --expose-gc).
  const heapFirst = report.sessions[0]?.memory.heapUsedMb ?? 0;
  const heapLast = report.sessions.at(-1)?.memory.heapUsedMb ?? 0;
  if (report.sessions.length >= 2 && heapLast - heapFirst > 40) {
    failures.push(`heap grew ${Math.round(heapLast - heapFirst)} MB between the first and last session`);
  }
  return failures;
}
