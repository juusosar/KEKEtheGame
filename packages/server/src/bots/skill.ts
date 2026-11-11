// Bot difficulty (host setting `botLevel`): one table of knobs per level. Bots move at the same speed and
// play by the same rules as people; a level changes only how they decide and how well they fight.
import type { BotLevel } from '@keke/shared';

/** What a bot cares about most when it is free to choose (it always fetches its own target otherwise). */
export type BotPersona = 'runner' | 'thief' | 'brawler';

export interface BotSkill {
  /** Seconds between two decisions (goal, foe): the bot's reaction time. */
  readonly thinkSeconds: number;
  /** Chance per input frame to swing at a foe in reach (an attack also needs the weapon's cooldown). */
  readonly swingChance: number;
  /** Largest aim error in radians, either way. */
  readonly aimErrorRadians: number;
  /** Leads moving targets with thrown weapons and shots. */
  readonly leadsShots: boolean;
  /** Chance per second to stand still for `pauseSeconds` (looks around, hesitates). */
  readonly pauseChancePerSecond: number;
  readonly pauseSeconds: number;
  /**
   * Keeps out of trouble with the staff: no fights a guard can see, no staff-only rooms or oven on its
   * paths, runs from a guard that chases it. Easy bots blunder into all of it.
   */
  readonly staffAware: boolean;
  /** Steers away from forklifts this many tiles away (0 = never looks). */
  readonly forkliftDodgeTiles: number;
  /** Goes after a foe carrying an order box (Race) within this many tiles. */
  readonly boxHuntTiles: number;
  /** Goes after a foe carrying anything within this many tiles (brawlers; others when they pass close). */
  readonly carrierHuntTiles: number;
  /** Picks up loose items lying this close (thieves; everyone on hard). */
  readonly looseItemTiles: number;
  /** Personas the bots of this level take turns with, by seat. */
  readonly personas: readonly BotPersona[];
}

export const BOT_SKILLS: Readonly<Record<BotLevel, BotSkill>> = {
  easy: {
    thinkSeconds: 0.7,
    swingChance: 0.08,
    aimErrorRadians: 0.6,
    leadsShots: false,
    pauseChancePerSecond: 0.12,
    pauseSeconds: 0.9,
    staffAware: false,
    forkliftDodgeTiles: 0,
    boxHuntTiles: 6,
    carrierHuntTiles: 0,
    looseItemTiles: 3,
    personas: ['runner'],
  },
  normal: {
    thinkSeconds: 0.35,
    swingChance: 0.3,
    aimErrorRadians: 0.25,
    leadsShots: false,
    pauseChancePerSecond: 0.04,
    pauseSeconds: 0.5,
    staffAware: true,
    forkliftDodgeTiles: 2,
    boxHuntTiles: 14,
    carrierHuntTiles: 6,
    looseItemTiles: 6,
    personas: ['runner', 'thief', 'brawler'],
  },
  hard: {
    thinkSeconds: 0.15,
    swingChance: 0.7,
    aimErrorRadians: 0.08,
    leadsShots: true,
    pauseChancePerSecond: 0,
    pauseSeconds: 0,
    staffAware: true,
    forkliftDodgeTiles: 3,
    boxHuntTiles: 30,
    carrierHuntTiles: 10,
    looseItemTiles: 10,
    personas: ['thief', 'brawler', 'runner'],
  },
};
