import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { BOT_NAMES, botSeats, isBotLevel, maxBots } from './bots';

const config = loadConfig();

describe('bot players', () => {
  it('fills every seat but the host’s', () => {
    expect(maxBots(config)).toBe(config.maxPlayersPerRoom - 1);
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(maxBots(config));
    for (const name of BOT_NAMES) expect(name.length).toBeLessThanOrEqual(config.nicknameMaxLength);
    expect(new Set(BOT_NAMES).size).toBe(BOT_NAMES.length);
  });

  it('gives people a bot’s seat when the room is full', () => {
    const max = config.maxPlayersPerRoom;
    expect(botSeats(3, 1, config)).toBe(3);
    expect(botSeats(max - 1, 1, config)).toBe(max - 1);
    expect(botSeats(max - 1, 3, config)).toBe(max - 3);
    expect(botSeats(5, max, config)).toBe(0);
    expect(botSeats(0, 1, config)).toBe(0);
  });

  it('knows the levels', () => {
    expect(isBotLevel('hard')).toBe(true);
    expect(isBotLevel('insane')).toBe(false);
  });
});
