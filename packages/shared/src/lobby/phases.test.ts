import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { ROUND_PHASES, nextPhase, phaseSeconds, totalRounds, type RoundPhase } from './phases';

const config = loadConfig();

describe('round state machine', () => {
  it('runs lobby → countdown → playing → roundResults → podium → lobby for one round', () => {
    const progress = { round: 1, totalRounds: 1 };
    const seen: RoundPhase[] = ['lobby'];
    for (let i = 0; i < 5; i++) seen.push(nextPhase(seen[seen.length - 1] as RoundPhase, progress));
    expect(seen).toEqual(['lobby', 'countdown', 'playing', 'roundResults', 'podium', 'lobby']);
  });

  it('goes back to countdown after roundResults while rounds remain', () => {
    expect(nextPhase('roundResults', { round: 1, totalRounds: 3 })).toBe('countdown');
    expect(nextPhase('roundResults', { round: 2, totalRounds: 3 })).toBe('countdown');
    expect(nextPhase('roundResults', { round: 3, totalRounds: 3 })).toBe('podium');
  });

  it('times every phase from config, and the lobby not at all', () => {
    expect(phaseSeconds('lobby', 'timed', config)).toBeNull();
    expect(phaseSeconds('countdown', 'timed', config)).toBe(config.countdownSeconds);
    expect(phaseSeconds('playing', 'timed', config)).toBe(config.timedRoundSeconds);
    expect(phaseSeconds('playing', 'race', config)).toBe(config.raceRoundSeconds);
    expect(phaseSeconds('roundResults', 'race', config)).toBe(config.roundResultsSeconds);
    expect(phaseSeconds('podium', 'race', config)).toBe(config.podiumSeconds);
    expect(ROUND_PHASES).toHaveLength(5);
  });

  it('counts rounds per map times maps', () => {
    expect(totalRounds(3)).toBe(3);
    expect(totalRounds(2, 2)).toBe(4);
  });
});
