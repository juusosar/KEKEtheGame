// Host rules on the client: presets, value formatting, the lobby's summary lines and the remembered room
// setup. The rules themselves (keys, ranges, validation) live in @keke/shared (lobby/rules.ts).
import {
  DEFAULT_LOBBY_SETTINGS,
  isBotLevel,
  GAME_MODES,
  RULES,
  hostRulesSchema,
  isMapChoice,
  normalizeRules,
  readRules,
  type GameConfig,
  type GameMode,
  type HostRules,
  type LobbySettings,
  type RuleGroup,
  type RuleKey,
  type RuleSpec,
} from '@keke/shared';
import type { MessageKey } from '../i18n';
import { t } from '../i18n';

export const RULE_LABEL: Record<RuleKey, MessageKey> = {
  timedRoundSeconds: 'rules.timedRoundSeconds',
  raceRoundSeconds: 'rules.raceRoundSeconds',
  countdownSeconds: 'rules.countdownSeconds',
  roundResultsSeconds: 'rules.roundResultsSeconds',
  podiumSeconds: 'rules.podiumSeconds',
  raceQuota: 'rules.raceQuota',
  raceTeamQuotaPerMember: 'rules.raceTeamQuotaPerMember',
  maxHp: 'rules.maxHp',
  hpRegenPerSec: 'rules.hpRegenPerSec',
  playerSpeed: 'rules.playerSpeed',
  carrySpeedMultiplier: 'rules.carrySpeedMultiplier',
  respawnSeconds: 'rules.respawnSeconds',
  spawnProtectionSeconds: 'rules.spawnProtectionSeconds',
  roundStartProtectionSeconds: 'rules.roundStartProtectionSeconds',
  wantedSeconds: 'rules.wantedSeconds',
  npcRespawnSeconds: 'rules.npcRespawnSeconds',
  looseItemDespawnSeconds: 'rules.looseItemDespawnSeconds',
  jokeItemChance: 'rules.jokeItemChance',
};

export const RULE_GROUP_LABEL: Record<RuleGroup, MessageKey> = {
  round: 'rules.group.round',
  race: 'rules.group.race',
  players: 'rules.group.players',
  combat: 'rules.group.combat',
  store: 'rules.group.store',
};

/** Ready-made rule sets for the setup menu. `standard` is the server's values. */
export const RULE_PRESETS = ['standard', 'quick', 'long', 'brawl'] as const;
export type RulePreset = (typeof RULE_PRESETS)[number];

export const PRESET_RULES: Readonly<Record<RulePreset, Readonly<HostRules>>> = {
  standard: {},
  quick: {
    timedRoundSeconds: 90,
    raceRoundSeconds: 120,
    raceQuota: 4,
    raceTeamQuotaPerMember: 2,
    countdownSeconds: 2,
    roundResultsSeconds: 6,
    podiumSeconds: 10,
  },
  long: {
    timedRoundSeconds: 300,
    raceRoundSeconds: 420,
    raceQuota: 10,
    raceTeamQuotaPerMember: 4,
  },
  brawl: {
    maxHp: 50,
    respawnSeconds: 1.5,
    spawnProtectionSeconds: 1,
    playerSpeed: 190,
    wantedSeconds: 10,
    jokeItemChance: 0.2,
  },
};

export const PRESET_LABEL: Record<RulePreset, MessageKey> = {
  standard: 'rules.preset.standard',
  quick: 'rules.preset.quick',
  long: 'rules.preset.long',
  brawl: 'rules.preset.brawl',
};

/** Rules in the given group, in editor order. */
export function rulesIn(group: RuleGroup): RuleSpec[] {
  return RULES.filter((spec) => spec.group === group);
}

/**
 * What the number input shows for a value: percentages as whole percent (0.08 is 8), everything else
 * as is. `fromInput` is the inverse.
 */
export function toInput(spec: RuleSpec, value: number): number {
  return spec.unit === 'percent' ? Math.round(value * 100) : value;
}

export function fromInput(spec: RuleSpec, shown: number): number {
  return spec.unit === 'percent' ? shown / 100 : shown;
}

/** Input attributes for a rule (percent in whole percent). */
export function inputRange(spec: RuleSpec): { min: number; max: number; step: number } {
  return {
    min: toInput(spec, spec.min),
    max: toInput(spec, spec.max),
    step: spec.unit === 'percent' ? Math.max(1, Math.round(spec.step * 100)) : spec.step,
  };
}

/** A value for people: "3:00", "6 s", "8 %", "×0.85", "100 HP", "160 px/s", "6 items". */
export function formatRuleValue(spec: RuleSpec, value: number): string {
  switch (spec.unit) {
    case 'seconds':
      if (value >= 60 && Number.isInteger(value)) {
        const m = Math.floor(value / 60);
        const s = value % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
      }
      return t('rules.unit.secondsValue', { n: value });
    case 'percent':
      return t('rules.unit.percentValue', { n: Math.round(value * 100) });
    case 'multiplier':
      return t('rules.unit.multiplierValue', { n: value });
    case 'hp':
      return t('rules.unit.hpValue', { n: value });
    case 'speed':
      return t('rules.unit.speedValue', { n: value });
    case 'hpPerSecond':
      return t('rules.unit.hpPerSecondValue', { n: value });
    case 'count':
      return String(value);
  }
}

/** Unit text after the number input. */
export function unitLabel(spec: RuleSpec): string {
  const keys: Record<RuleSpec['unit'], MessageKey> = {
    seconds: 'rules.unit.seconds',
    count: 'rules.unit.count',
    percent: 'rules.unit.percent',
    multiplier: 'rules.unit.multiplier',
    hp: 'rules.unit.hp',
    speed: 'rules.unit.speed',
    hpPerSecond: 'rules.unit.hpPerSecond',
  };
  return t(keys[spec.unit]);
}

/** One line per rule the host changed, e.g. "Round time (Timed): 2:00 (standard 3:00)". */
export function rulesSummary(base: GameConfig, rules: HostRules): string[] {
  const lines: string[] = [];
  for (const spec of RULES) {
    const value = rules[spec.key];
    if (value === undefined) continue;
    lines.push(
      t('rules.summaryLine', {
        rule: t(RULE_LABEL[spec.key]),
        value: formatRuleValue(spec, value),
        standard: formatRuleValue(spec, base[spec.key]),
      }),
    );
  }
  return lines;
}

/** The preset these rules match exactly, or null for a custom set. */
export function matchingPreset(base: GameConfig, rules: HostRules): RulePreset | null {
  const key = (r: HostRules): string => JSON.stringify(normalizeRules(dropDefaults(base, r)));
  const mine = key(rules);
  return RULE_PRESETS.find((preset) => key(PRESET_RULES[preset]) === mine) ?? null;
}

function dropDefaults(base: GameConfig, rules: HostRules): HostRules {
  const out: HostRules = {};
  for (const spec of RULES) {
    const value = rules[spec.key];
    if (value !== undefined && Math.abs(value - base[spec.key]) > 1e-9) out[spec.key] = value;
  }
  return out;
}

// --- remembered setup ----------------------------------------------------------------------------------

/** localStorage key of the last room setup this browser created a room with. */
export const ROOM_SETUP_KEY = 'keke.roomSetup';

/** The setup menu's last choices from storage; anything missing or invalid falls back to the default. */
export function readRoomSetup(
  raw: string | null,
  maxRoundsPerMap: number,
  maxBotCount: number,
): LobbySettings {
  const fallback: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, rules: {} };
  if (raw === null) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof data !== 'object' || data === null) return fallback;
  const bag = data as Record<string, unknown>;
  const mode = bag['mode'];
  const rounds = bag['roundsPerMap'];
  const maps = bag['maps'];
  const rules = readRules(bag['rules']);
  const bots = bag['bots'];
  const botLevel = bag['botLevel'];
  return {
    mode:
      typeof mode === 'string' && (GAME_MODES as readonly string[]).includes(mode)
        ? (mode as GameMode)
        : fallback.mode,
    roundsPerMap:
      typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= 1 && rounds <= maxRoundsPerMap
        ? rounds
        : fallback.roundsPerMap,
    teams: typeof bag['teams'] === 'boolean' ? bag['teams'] : fallback.teams,
    maps: typeof maps === 'string' && isMapChoice(maps) ? maps : fallback.maps,
    rules: hostRulesSchema.safeParse(rules).success ? rules : {},
    bots:
      typeof bots === 'number' && Number.isInteger(bots) && bots >= 0
        ? Math.min(bots, maxBotCount)
        : fallback.bots,
    botLevel: isBotLevel(botLevel) ? botLevel : fallback.botLevel,
  };
}
