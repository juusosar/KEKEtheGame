// Host settings (§13.1): mode, rounds per map (1–max), teams on/off, maps (Phase 2 decision 1).
import { z } from 'zod';
import type { GameConfig } from '../config';
import { DEFAULT_MAP_CHOICE, MAP_CHOICES, type MapChoice } from './maps';
import { GAME_MODES, type GameMode } from './phases';

export interface LobbySettings {
  mode: GameMode;
  roundsPerMap: number;
  teams: boolean;
  /** Which store maps the session plays. The server refuses a choice it has no map for. */
  maps: MapChoice;
}

/** Free-for-all Timed, one round per map on both maps: the §4 defaults (maps: P3-1). */
export const DEFAULT_LOBBY_SETTINGS: Readonly<LobbySettings> = Object.freeze({
  mode: 'timed',
  roundsPerMap: 1,
  teams: false,
  maps: DEFAULT_MAP_CHOICE,
});

/** Schema for a host's partial settings update. Unknown keys are rejected. */
export function settingsUpdateSchema(config: GameConfig) {
  return z
    .object({
      mode: z.enum(GAME_MODES),
      roundsPerMap: z.number().int().min(1).max(config.maxRoundsPerMap),
      teams: z.boolean(),
      maps: z.enum(MAP_CHOICES),
    })
    .partial()
    .strict();
}

export type LobbySettingsUpdate = Partial<LobbySettings>;
