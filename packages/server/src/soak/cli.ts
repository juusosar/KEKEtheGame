import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { themes, type GameMode, type ThemeId } from '@keke/shared';
import { DEFAULT_CLIENT_DIST } from '../app';
import { startBrowserPlayers, type BrowserPlayers } from './browsers';
import { DEFAULT_SESSIONS, judge, planName, runSoak, type SessionPlan } from './runSoak';

// M7-4: `npm run soak` runs the 8-player soak and prints a summary; the full report goes to
// test-results/soak/report.json. Exit code 1 when the soak failed. Options:
//   --players 8          players in the room (the first bot hosts)
//   --browsers 0         how many of them are real clients in headless Chromium (needs npm run build)
//   --sessions timed,race,timed+teams,race+teams,timed@prisma,race@prisma,timed@both,race+teams@both
//                        sessions played back to back, 3 rounds each; `@<map>` plays it on that map
//                        (default: the first map), `@both` plays 3 rounds on each map (P3-3)
//   --rounds 3           rounds per session (1 to maxRoundsPerMap)
//   --timed 45 --race 75 round lengths in seconds (the game's real ones are 180 and 240)
//   --port 2597 --seed 7 --out <file>

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '8' },
    browsers: { type: 'string', default: '0' },
    sessions: { type: 'string' },
    rounds: { type: 'string', default: '3' },
    timed: { type: 'string' },
    race: { type: 'string' },
    port: { type: 'string', default: '2597' },
    seed: { type: 'string', default: '7' },
    out: { type: 'string', default: 'test-results/soak/report.json' },
  },
});

const rounds = Number(values.rounds);
const sessions: SessionPlan[] = values.sessions
  ? values.sessions.split(',').map((s) => {
      const [plan = '', map] = s.trim().split('@');
      const [mode, flag] = plan.split('+');
      if (mode !== 'timed' && mode !== 'race') throw new Error(`unknown session "${s}"`);
      if (map !== undefined && map !== 'both' && !Object.hasOwn(themes, map)) {
        throw new Error(`unknown map in session "${s}"`);
      }
      return {
        mode: mode as GameMode,
        teams: flag === 'teams',
        rounds,
        ...(map ? { map: map as ThemeId | 'both' } : {}),
      };
    })
  : DEFAULT_SESSIONS.map((s) => ({ ...s, rounds }));

const config = {
  ...(values.timed ? { timedRoundSeconds: Number(values.timed) } : {}),
  ...(values.race ? { raceRoundSeconds: Number(values.race) } : {}),
};

if (!(globalThis as { gc?: unknown }).gc) {
  console.log('soak: run node with --expose-gc for comparable heap numbers (npm run soak does).');
}

const browserCount = Number(values.browsers);
let browsers: BrowserPlayers | undefined;
const log = (line: string) => console.log(line);

const report = await runSoak({
  port: Number(values.port),
  players: Number(values.players) - browserCount,
  ...(browserCount > 0
    ? {
        clientDist: DEFAULT_CLIENT_DIST,
        extraPlayers: async (code: string, url: string) => {
          browsers = await startBrowserPlayers(browserCount, log);
          await browsers.join(code, url);
        },
        beforeStart: async () => browsers?.ready(),
        stopExtraPlayers: async () => browsers?.close(),
      }
    : {}),
  sessions,
  config,
  seed: Number(values.seed),
  log,
});
if (browsers) {
  report.errors.push(...browsers.errors);
  report.players += browserCount;
  report.failures = judge(report, sessions);
  report.ok = report.failures.length === 0;
}

const out = resolve(values.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

console.log('');
for (const [i, s] of report.sessions.entries()) {
  console.log(`session ${i + 1} ${planName(s.plan)}: ${s.seconds} s`);
  for (const r of s.rounds) {
    console.log(
      `  round ${r.round} ${r.map}: ${r.playingSeconds} s playing, ${r.deposited} pts deposited` +
        `${r.raceWinner ? `, delivered by ${r.raceWinner}` : ''}; tick mean ${r.ticks.meanMs} ms` +
        ` p95 ${r.ticks.p95Ms} max ${r.ticks.maxMs}; patch mean ${r.patches.meanMs} ms max ${r.patches.maxMs}` +
        `; heap ${r.heapUsedMb} MB`,
    );
  }
  console.log(`  heap ${s.memory.heapUsedMb} MB, rss ${s.memory.rssMb} MB`);
}
console.log(`events: ${JSON.stringify(report.events)}`);
console.log(`bots: ${JSON.stringify(report.bots)}`);
console.log(
  `desync checks: ${report.desyncChecks}, desyncs: ${report.desyncs.length}, errors: ${report.errors.length}`,
);
for (const e of [...report.errors, ...report.desyncs].slice(0, 20)) console.log(`  ${e.split('\n')[0]}`);
console.log(report.ok ? `SOAK PASSED in ${report.seconds} s` : `SOAK FAILED: ${report.failures.join('; ')}`);
console.log(`report: ${out}`);
process.exit(report.ok ? 0 : 1);
