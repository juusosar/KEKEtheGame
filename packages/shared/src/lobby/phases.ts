// Round state machine (§15.3): lobby → countdown → playing → roundResults → (countdown | podium) → lobby.
import type { GameConfig } from '../config';

export const GAME_MODES = ['timed', 'race'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const ROUND_PHASES = ['lobby', 'countdown', 'playing', 'roundResults', 'podium'] as const;
export type RoundPhase = (typeof ROUND_PHASES)[number];

/** Where the session stands when a phase ends. `round` is 1-based; `totalRounds` comes from `totalRounds()`. */
export interface SessionProgress {
  readonly round: number;
  readonly totalRounds: number;
}

/**
 * The phase that follows `phase` when it ends on its own (timer or host Start).
 * After roundResults the next round's countdown starts, or the podium after the last round.
 */
export function nextPhase(phase: RoundPhase, progress: SessionProgress): RoundPhase {
  switch (phase) {
    case 'lobby':
      return 'countdown';
    case 'countdown':
      return 'playing';
    case 'playing':
      return 'roundResults';
    case 'roundResults':
      return progress.round < progress.totalRounds ? 'countdown' : 'podium';
    case 'podium':
      return 'lobby';
  }
}

/** How long a phase lasts in seconds; null means it has no timer (the lobby waits for Start). */
export function phaseSeconds(phase: RoundPhase, mode: GameMode, config: GameConfig): number | null {
  switch (phase) {
    case 'lobby':
      return null;
    case 'countdown':
      return config.countdownSeconds;
    case 'playing':
      return mode === 'timed' ? config.timedRoundSeconds : config.raceRoundSeconds;
    case 'roundResults':
      return config.roundResultsSeconds;
    case 'podium':
      return config.podiumSeconds;
  }
}

/** Rounds in a session: rounds per map × maps played (§5). Only the store map exists until phase 2. */
export function totalRounds(roundsPerMap: number, mapCount = 1): number {
  return roundsPerMap * mapCount;
}
