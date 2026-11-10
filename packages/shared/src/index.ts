// Public entry point of @keke/shared. Pure TS only: no Phaser, no Colyseus, no DOM.

export { Rng, createRng, type Weighted } from './rng';
export { Button, buttonsOf, isPressed, type ButtonName, type InputFrame, type Vec2 } from './types';
export { ConfigError, configSchema, formatIssues, loadConfig, type GameConfig } from './config';
export * from './profile';
export * from './lobby';
export * from './items';
export * from './weapons';
export {
  aabbOverlapsSolid,
  circleSeparation,
  circlesOverlap,
  isSolidTile,
  moveAabb,
  type Circle,
  type CollisionGrid,
  type HalfSize,
  type MoveResult,
} from './rules/collision';
export {
  carryMultiplier,
  normalizeMove,
  playerHalfSize,
  step,
  type FloorZone,
  type MovementConfig,
  type MovementMap,
  type MovementState,
  type StepModifiers,
} from './rules/movement';
export {
  InputQueue,
  MAX_INPUT_SEQ,
  applyInput,
  inputStepSeconds,
  sanitizeInputFrame,
  type InputQueueConfig,
} from './rules/input';
export { findSpawn, vanSpawn, type SpawnMap } from './rules/spawn';
export { NORMAL_ITEM_VALUE, itemValue } from './rules/scoring';
export {
  assignVans,
  inDepositRange,
  inPickupRange,
  nearestInReach,
  vanCentre,
  type ReachConfig,
  type VanAssignmentOptions,
  type VanRosterEntry,
} from './rules/vans';
export {
  eligibleSpawns,
  modelCAssigner,
  spawnsForItem,
  type TargetAssigner,
  type TargetConfig,
  type TargetItemDef,
  type TargetMap,
  type TargetPlacement,
  type TargetRequest,
  type TargetSpawnPoint,
} from './rules/targets';
export {
  addCarryPlayer,
  assignTargets,
  createItemWorld,
  deposit,
  despawnLooseItems,
  drop,
  findItem,
  findCarryPlayer,
  isCarrying,
  pickup,
  removeCarryPlayer,
  setPlayerVan,
  vanPointsOf,
  type AssignTargetsContext,
  type CarryPlayer,
  type CarryRejection,
  type CarryResult,
  type DropReason,
  type ItemEvent,
  type ItemWorld,
  type PickupKind,
  type WorldItem,
  type WorldItemState,
} from './rules/carry';
export {
  isTimedRoundOver,
  rankByItemPoints,
  rankTimedRound,
  teamSideId,
  type PlayerPlacement,
  type Ranked,
  type TimedPlayerScore,
  type TimedRoundResult,
} from './rules/modes/timed';
export {
  addCombatant,
  armOnPickup,
  attackBlocked,
  canHit,
  combatSpeedMultiplier,
  createCombatWorld,
  dropItemsOnKo,
  findCombatant,
  hit,
  hitBlocked,
  isFriendly,
  isStunned,
  regenerate,
  removeCombatant,
  respawnDue,
  rollWeapon,
  setCombatTeam,
  useWeapon,
  type AttackRejection,
  type CombatConfig,
  type CombatEvent,
  type CombatResult,
  type CombatWorld,
  type Combatant,
  type HeldWeapon,
  type HitRejection,
  type HitSource,
  type HitSpec,
  type PickupWhat,
} from './rules/combat';
export { placementPointsFor, rankSession, type SessionSide, type SessionStanding } from './rules/session';
export {
  MapError,
  OBJECT_LAYERS,
  TILE_LAYERS,
  inOfficeTrigger,
  loadMap,
  zoneAt,
  zonesAt,
  type Bounds,
  type MapCollisionGrid,
  type ForkliftRoute,
  type ItemSpawn,
  type MapModel,
  type NpcSpawn,
  type NpcWaypoint,
  type OfficeTrigger,
  type VanSlot,
  type Zone,
} from './map';

/** Clamps `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) is greater than max (${max})`);
  }
  return Math.min(max, Math.max(min, value));
}
export {
  allGuardedTerms,
  defaultThemeId,
  findBrandTerms,
  getTheme,
  kesproTheme,
  prismaTheme,
  themes,
  type BrandHit,
  type HexColor,
  type MapTheme,
  type ThemeAssets,
  type ThemeBrand,
  type ThemeColors,
  type ThemeId,
} from './theme';
