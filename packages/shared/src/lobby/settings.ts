// Host settings (§13.1): mode, rounds per map (1–max), teams on/off.
import { z } from 'zod';
import type { GameConfig } from '../config';
import { GAME_MODES, type GameMode } from './phases';

export interface LobbySettings {
  mode: GameMode;
  roundsPerMap: number;
  teams: boolean;
}

/** Free-for-all Timed, one round: the §4 defaults. */
export const DEFAULT_LOBBY_SETTINGS: Readonly<LobbySettings> = Object.freeze({
  mode: 'timed',
  roundsPerMap: 1,
  teams: false,
});

/** Schema for a host's partial settings update. Unknown keys are rejected. */
export function settingsUpdateSchema(config: GameConfig) {
  return z
    .object({
      mode: z.enum(GAME_MODES),
      roundsPerMap: z.number().int().min(1).max(config.maxRoundsPerMap),
      teams: z.boolean(),
    })
    .partial()
    .strict();
}

export type LobbySettingsUpdate = Partial<LobbySettings>;
