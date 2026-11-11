import { describe, expect, it } from 'vitest';
import { runSoak } from './runSoak';

// M7-4: a short soak in the default gate, so the soak harness keeps working: 8 bots, a 2-round Race with
// teams on, short rounds. It checks errors, desync and the session flow only; the full soak
// (`npm run soak`, 4 sessions of 3 rounds) also requires the bots to have done everything at least once.
// Own port (memory: 2596 and 2597 are M7-4's; the CLI defaults to 2597).
const PORT = 2596;

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
    expect(report.events['attack']).toBeGreaterThan(0);
  });
});
