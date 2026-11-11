// Host settings (§13.1): mode, rounds per map (1–max), teams on/off, maps (Phase 2 decision 1) and the
// host's rules (config values for this room, see rules.ts) and bot players (bots.ts).
import { z } from 'zod';
import type { GameConfig } from '../config';
import { BOT_LEVELS, DEFAULT_BOT_LEVEL, maxBots, type BotLevel } from './bots';
import { DEFAULT_MAP_CHOICE, MAP_CHOICES, type MapChoice } from './maps';
import { GAME_MODES, type GameMode } from './phases';
import { hostRulesSchema, type HostRules } from './rules';

export interface LobbySettings {
  mode: GameMode;
  roundsPerMap: number;
  teams: boolean;
  /** Which store maps the session plays. The server refuses a choice it has no map for. */
  maps: MapChoice;
  /** Config values the host set for this room; empty plays the server's values. */
  rules: HostRules;
  /** Bot players the server adds to fill seats (0 = none); people take a bot's seat when the room is full. */
  bots: number;
  /** Difficulty of every bot in the room. */
  botLevel: BotLevel;
}

/** Free-for-all Timed, one round per map on both maps: the §4 defaults (maps: P3-1). */
export const DEFAULT_LOBBY_SETTINGS: Readonly<LobbySettings> = Object.freeze({
  mode: 'timed',
  roundsPerMap: 1,
  teams: false,
  maps: DEFAULT_MAP_CHOICE,
  rules: Object.freeze({}) as HostRules,
  bots: 0,
  botLevel: DEFAULT_BOT_LEVEL,
});

/**
 * Schema for a host's partial settings update. Unknown keys are rejected. `rules` replaces the room's
 * whole rule set (send `{}` to go back to the server's values).
 */
export function settingsUpdateSchema(config: GameConfig) {
  return z
    .object({
      mode: z.enum(GAME_MODES),
      roundsPerMap: z.number().int().min(1).max(config.maxRoundsPerMap),
      teams: z.boolean(),
      maps: z.enum(MAP_CHOICES),
      rules: hostRulesSchema,
      bots: z.number().int().min(0).max(maxBots(config)),
      botLevel: z.enum(BOT_LEVELS),
    })
    .partial()
    .strict();
}

export type LobbySettingsUpdate = Partial<LobbySettings>;
