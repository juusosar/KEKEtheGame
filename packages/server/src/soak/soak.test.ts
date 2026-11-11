import { describe, expect, it } from 'vitest';
import { runSoak } from './runSoak';

// M7-4: a short soak in the default gate, so the soak harness keeps working: 8 bots, a 2-round Race with
// teams on, short rounds. It checks errors, desync and the session flow only; the full soak
// (`npm run soak`, 4 sessions of 3 rounds) also requires the bots to have done everything at least once.
// Own port (memory: 2596 and 2597 are M7-4's; the CLI defaults to 2597).
const PORT = 2596;
/** P1-6: the second map's short soak. */
const PRISMA_PORT = 2603;
/** P3-3: a session over both maps. */
const BOTH_PORT = 2613;

describe('soak (8 bots, short)', () => {
  it('plays a 2-round Race with teams without errors or desync', { timeout: 60_000 }, async () => {
    const report = await runSoak({
      port: PORT,
      players: 8,
      sessions: [{ mode: 'race', teams: true, rounds: 2 }],
      config: { countdownSeconds: 0.5, raceRoundSeconds: 6, roundResultsSeconds: 0.5, podiumSeconds: 0.5 },
      desyncEverySeconds: 3,
    });
    expect(report.errors).toEqual([]);
    expect(report.desyncs).toEqual([]);
    expect(report.desyncChecks).toBeGreaterThan(0);
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]?.rounds).toHaveLength(2);
    expect(report.sessions[0]?.flowProblems).toEqual([]);
    expect(report.bots.framesSent).toBeGreaterThan(0);
    // No activity check here: whether bots meet within reach in 2 × 6 s depends on how fast a loaded
    // machine runs them (M7 review F2). The full `npm run soak` still requires attacks, KOs and so on.
  });

  it(
    'plays a 2-round Timed session on the second map without errors or desync (P1-6)',
    { timeout: 60_000 },
    async () => {
      const report = await runSoak({
        port: PRISMA_PORT,
        players: 8,
        sessions: [{ mode: 'timed', teams: false, rounds: 2, map: 'prisma' }],
        config: { countdownSeconds: 0.5, timedRoundSeconds: 6, roundResultsSeconds: 0.5, podiumSeconds: 0.5 },
        desyncEverySeconds: 3,
      });
      expect(report.errors).toEqual([]);
      expect(report.desyncs).toEqual([]);
      expect(report.desyncChecks).toBeGreaterThan(0);
      expect(report.sessions[0]?.rounds).toHaveLength(2);
      expect(report.sessions[0]?.flowProblems).toEqual([]);
      expect(report.bots.framesSent).toBeGreaterThan(0);
      // No activity check, as above: on this map the vans are in the lot, so a first pickup takes a walk
      // that a loaded machine may not finish in 6 s. The full `npm run soak` plays it with real timers.
    },
  );

  it(
    'plays a Both session, one round on each map, without errors or desync across the switch (P3-3)',
    { timeout: 60_000 },
    async () => {
      const report = await runSoak({
        port: BOTH_PORT,
        players: 8,
        sessions: [{ mode: 'race', teams: true, rounds: 1, map: 'both' }],
        config: { countdownSeconds: 0.5, raceRoundSeconds: 6, roundResultsSeconds: 0.5, podiumSeconds: 0.5 },
        desyncEverySeconds: 3,
      });
      expect(report.errors).toEqual([]);
      expect(report.desyncs).toEqual([]);
      expect(report.desyncChecks).toBeGreaterThan(0);
      // The map checks at each round start and in the lobby are flow problems.
      expect(report.sessions[0]?.flowProblems).toEqual([]);
      expect(report.sessions[0]?.rounds.map((r) => r.map)).toEqual(['kespro', 'prisma']);
      expect(report.bots.framesSent).toBeGreaterThan(0);
    },
  );
});
