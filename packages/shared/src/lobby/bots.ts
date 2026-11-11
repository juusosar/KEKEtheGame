// Bot players (host setting): server-run players that fill seats in the lobby and play every mode on
// every map. The host sets how many and one difficulty for all of them.
import type { GameConfig } from '../config';

/** Bot difficulty: how fast they react, how often and how well they swing, how careful they are. */
export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const DEFAULT_BOT_LEVEL: BotLevel = 'normal';

export function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === 'string' && (BOT_LEVELS as readonly string[]).includes(value);
}

/** Most bots a room can hold: every seat but the host's. */
export function maxBots(config: Pick<GameConfig, 'maxPlayersPerRoom'>): number {
  return Math.max(0, config.maxPlayersPerRoom - 1);
}

/** Bot nicknames, in the order seats fill. Short enough for any nameplate (nicknameMaxLength 16). */
export const BOT_NAMES = [
  'Bot Aino',
  'Bot Eero',
  'Bot Helmi',
  'Bot Onni',
  'Bot Siiri',
  'Bot Väinö',
  'Bot Lempi',
  'Bot Toivo',
  'Bot Kerttu',
  'Bot Urho',
  'Bot Impi',
  'Bot Arvo',
  'Bot Martta',
  'Bot Veikko',
  'Bot Saima',
  'Bot Pertti',
] as const;

/**
 * How many bots sit in the room: what the host asked for, less any seat a person needs. People always
 * win a seat; a bot leaves when one joins a full room and comes back when a seat frees up.
 */
export function botSeats(
  requested: number,
  humans: number,
  config: Pick<GameConfig, 'maxPlayersPerRoom'>,
): number {
  return Math.max(0, Math.min(requested, maxBots(config), config.maxPlayersPerRoom - humans));
}
