// Map choice (§5, Phase 2 decision 1): which store maps a session plays. A host setting; the server
// checks the choice against the maps it has loaded (themes with `available: true`).
import { defaultThemeId, type ThemeId } from '../theme';

/** Every map choice: one theme id, or `both` (the 'kespro' rounds first, then 'prisma', §5). */
export const MAP_CHOICES = ['kespro', 'prisma', 'both'] as const satisfies readonly (ThemeId | 'both')[];
export type MapChoice = (typeof MAP_CHOICES)[number];

/** The lobby default: the MVP map alone (becomes `both` once cross-map sessions land, P3-1). */
export const DEFAULT_MAP_CHOICE: MapChoice = defaultThemeId;

/** The maps a session with this choice plays, in order. */
export function mapRotation(choice: MapChoice): readonly ThemeId[] {
  return choice === 'both' ? ['kespro', 'prisma'] : [choice];
}

/**
 * The map of round `round` (1-based): each map plays `roundsPerMap` rounds in rotation order. Rounds
 * outside the session (0 in the lobby) get the first map.
 */
export function mapForRound(choice: MapChoice, round: number, roundsPerMap: number): ThemeId {
  const rotation = mapRotation(choice);
  const per = Math.max(1, Math.floor(roundsPerMap));
  const index = Math.min(rotation.length - 1, Math.max(0, Math.floor((round - 1) / per)));
  return rotation[index] as ThemeId;
}

/** True when every map of the choice is loaded on this server. */
export function mapChoiceAvailable(choice: MapChoice, available: Iterable<ThemeId>): boolean {
  const have = new Set(available);
  return mapRotation(choice).every((id) => have.has(id));
}

/** Type guard for a map choice from the wire or a synced string. */
export function isMapChoice(value: unknown): value is MapChoice {
  return typeof value === 'string' && (MAP_CHOICES as readonly string[]).includes(value);
}
