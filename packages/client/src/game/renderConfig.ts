// Client-only render tunables (§21: tunable numbers live in data files). Game rules stay in shared/config.json.
import raw from './render-config.json';

export interface RenderConfig {
  /** Integer camera zoom (§11.1: 2×). */
  readonly cameraZoom: number;
  /** Camera follow smoothing, 0..1 (1 = locked to the player). */
  readonly cameraLerp: number;
  /** The camera cuts to us instead of sliding when we are further than this from its centre (respawn), px. */
  readonly cameraCutPx: number;
  /** Longest frame the local simulation steps in one go, so a stalled tab does not tunnel. */
  readonly maxFrameSeconds: number;
  /** Sprite origin Y (0..1): the frame row that sits on the player's position (centre of the hitbox). */
  readonly playerOriginY: number;
  /** Integer scale of the character preview on the Profile screen. */
  readonly menuPreviewScale: number;
  readonly debugZoneAlpha: number;
  readonly debugWallAlpha: number;
  /** Seconds the spectator camera stays on one player before moving to the next (§13.1). */
  readonly spectatorCycleSeconds: number;
  /** Remote players are drawn this far in the past, between two state patches (§15.3: ~100 ms). */
  readonly interpolationDelayMs: number;
  /** A remote player jumping further than this (spawn) snaps instead of sliding, px. */
  readonly snapDistancePx: number;
  /** Opacity of a player inside the reconnect window, 0..1. */
  readonly disconnectedAlpha: number;
  /** Nameplate bottom edge, px above the player's position. */
  readonly nameplateOffsetY: number;
  /** A carried item's bottom edge, px above the carrier's position (top of the head). */
  readonly carriedItemGapPx: number;
  /** Owner-colour outline around a target item lying in the world (§3.1), px. */
  readonly itemOutlinePx: number;
  /** Owner (or team) colour frame around a van, px. */
  readonly vanOutlinePx: number;
  /** Team-colour outline around a player's body with Teams on (§4.3, M6-4), px. 0 = none. */
  readonly playerOutlinePx: number;
  /** Teams (playtest 1 problem 7): a team-colour ring on the floor under each body, px; 0 = none. */
  readonly teamRingWidthPx: number;
  readonly teamRingHeightPx: number;
  /** Ring centre below the player's position (the hitbox centre), px. */
  readonly teamRingOffsetY: number;
  /** Ring fill opacity, 0..1 (the edge is drawn solid). */
  readonly teamRingFillAlpha: number;
  /** Team-colour nameplate background opacity, 0..1. */
  readonly teamNameplateAlpha: number;
  /** Period of the joke-item twinkle (§10.1: "a little sparkle so everyone notices them"), seconds. */
  readonly jokeTwinkleSeconds: number;
  /** Rows in the HUD mini scoreboard before our own row is added (§13.2: top 5 + you). */
  readonly hudMiniRows: number;
  /** Event feed lines kept on screen at once. */
  readonly hudFeedLines: number;
  /** Seconds an event feed line stays. */
  readonly hudFeedSeconds: number;
  /** Other players' Wanted lines show only within this distance of us, world px (playtest 1 problem 8). */
  readonly hudFeedNearPx: number;
  /** The round timer turns to its warning style at or below this many seconds. */
  readonly hudTimerWarnSeconds: number;
  /** Target arrow distance from the screen edge, CSS px. */
  readonly hudArrowMarginPx: number;
  /** How far the target arrow floats above an on-screen target, CSS px. */
  readonly hudArrowHoverPx: number;
  /** The arrow's centre stays this far from any HUD panel (half its size plus a gap), px (playtest 1). */
  readonly hudArrowAvoidPx: number;
  /** Sliding off a panel, the arrow never comes closer than this to the screen centre, px. */
  readonly hudArrowMinFromCentrePx: number;
  /** How long a melee swing arc stays drawn (M4-2 feedback), seconds. */
  readonly swingFxSeconds: number;
  /** How long a body flashes white after a hit, seconds. */
  readonly hitFlashSeconds: number;
  /** Opacity of a KO'd body lying on the floor, 0..1. */
  readonly koAlpha: number;
  /** Blink rate of a spawn-protected body, Hz. */
  readonly protectedBlinkHz: number;
  /** Width of the small HP bar over a hurt player, px. */
  readonly hpBarWidthPx: number;
  /** HP bar height above the player's position, px (just under the nameplate). */
  readonly hpBarOffsetY: number;
  /** Opacity of the spray cone drawn while someone sprays (M4-4), 0..1. */
  readonly sprayFxAlpha: number;
  /** Opacity at the centre of a spray vision cloud (§7 extinguisher "blocks vision slightly"), 0..1. */
  readonly sprayCloudAlpha: number;
  /** A vision cloud fades out over its last this-many seconds. */
  readonly sprayCloudFadeSeconds: number;
  /** Life of a one-off FX frame (hit spark, splat, puff), seconds. */
  readonly fxBurstSeconds: number;
  /** How long a floating damage number stays, seconds. */
  readonly damageNumberSeconds: number;
  /** How far a damage number floats up over its life, px. */
  readonly damageNumberRisePx: number;
  /** Held weapon distance from the body centre along the aim, px (§11.1). */
  readonly heldWeaponReachPx: number;
  /** Held weapon (hand) height above the player's position, px. */
  readonly heldWeaponLiftPx: number;
  /** Scale of the 32 × 32 held weapon frame. */
  readonly heldWeaponScale: number;
  /** Length of one swing or use animation of the held weapon, seconds. */
  readonly heldSwingSeconds: number;
  /** How far a throw, spray, peel, cork or charge kicks the hand forward, px. */
  readonly heldUseKickPx: number;
  /** KO stars height above a KO'd body's position, px. */
  readonly koStarsOffsetY: number;
  /** KO stars turns per second. */
  readonly koStarsSpinHz: number;
  /** The HUD HP bar turns amber at or below this share of max HP. */
  readonly hudHpWarnFraction: number;
  /** The HUD HP bar turns red at or below this share of max HP. */
  readonly hudHpLowFraction: number;
  /** How long the HUD weapon slot glows after a new weapon, seconds. */
  readonly hudWeaponFlashSeconds: number;
  /** Wanted ❗ icon bottom edge, px above the player's position (over the nameplate; M5-7). */
  readonly wantedIconOffsetY: number;
  /** Forklift warning light blinks per second (M5-7). */
  readonly forkliftLightBlinkHz: number;
  /** A forklift beep fades to silence at this distance from the camera's player, px (M5-7). */
  readonly forkliftBeepHearingPx: number;
  /** Other players' sounds (hits, pickups, ...) fade to silence at this distance, px (M7-2). */
  readonly sfxHearingPx: number;
  /** At most one customer gasp this often, s: a group that panics together gasps once (P2-4). */
  readonly customerGaspMinGapSeconds: number;
}

/** Validates the render config. Throws with every problem listed. */
export function parseRenderConfig(data: unknown): RenderConfig {
  const issues: string[] = [];
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const num = (key: string, check: (n: number) => boolean, rule: string): number => {
    const v = obj[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || !check(v)) issues.push(`${key}: must be ${rule}`);
    return v as number;
  };
  const cameraZoom = num('cameraZoom', (n) => Number.isInteger(n) && n >= 1, 'an integer >= 1');
  const cameraLerp = num('cameraLerp', (n) => n > 0 && n <= 1, 'in (0, 1]');
  const cameraCutPx = num('cameraCutPx', (n) => n > 0, 'positive');
  const maxFrameSeconds = num('maxFrameSeconds', (n) => n > 0, 'positive');
  const playerOriginY = num('playerOriginY', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const menuPreviewScale = num('menuPreviewScale', (n) => Number.isInteger(n) && n >= 1, 'an integer >= 1');
  const debugZoneAlpha = num('debugZoneAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const debugWallAlpha = num('debugWallAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const spectatorCycleSeconds = num('spectatorCycleSeconds', (n) => n > 0, 'positive');
  const interpolationDelayMs = num('interpolationDelayMs', (n) => n >= 0, '>= 0');
  const snapDistancePx = num('snapDistancePx', (n) => n > 0, 'positive');
  const disconnectedAlpha = num('disconnectedAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const nameplateOffsetY = num('nameplateOffsetY', () => true, 'a number');
  const carriedItemGapPx = num('carriedItemGapPx', (n) => n >= 0, '>= 0');
  const itemOutlinePx = num('itemOutlinePx', (n) => Number.isInteger(n) && n >= 0, 'an integer >= 0');
  const vanOutlinePx = num('vanOutlinePx', (n) => n >= 0, '>= 0');
  const playerOutlinePx = num('playerOutlinePx', (n) => Number.isInteger(n) && n >= 0, 'an integer >= 0');
  const teamRingWidthPx = num('teamRingWidthPx', (n) => n >= 0, '>= 0');
  const teamRingHeightPx = num('teamRingHeightPx', (n) => n >= 0, '>= 0');
  const teamRingOffsetY = num('teamRingOffsetY', Number.isFinite, 'a number');
  const teamRingFillAlpha = num('teamRingFillAlpha', (n) => n >= 0 && n <= 1, 'in 0..1');
  const teamNameplateAlpha = num('teamNameplateAlpha', (n) => n >= 0 && n <= 1, 'in 0..1');
  const jokeTwinkleSeconds = num('jokeTwinkleSeconds', (n) => n > 0, 'positive');
  const hudMiniRows = num('hudMiniRows', (n) => Number.isInteger(n) && n >= 1, 'an integer >= 1');
  const hudFeedLines = num('hudFeedLines', (n) => Number.isInteger(n) && n >= 1, 'an integer >= 1');
  const hudFeedSeconds = num('hudFeedSeconds', (n) => n > 0, 'positive');
  const hudFeedNearPx = num('hudFeedNearPx', (n) => n >= 0, '>= 0');
  const hudTimerWarnSeconds = num('hudTimerWarnSeconds', (n) => n >= 0, '>= 0');
  const hudArrowMarginPx = num('hudArrowMarginPx', (n) => n >= 0, '>= 0');
  const hudArrowHoverPx = num('hudArrowHoverPx', (n) => n >= 0, '>= 0');
  const hudArrowAvoidPx = num('hudArrowAvoidPx', (n) => n >= 0, '>= 0');
  const hudArrowMinFromCentrePx = num('hudArrowMinFromCentrePx', (n) => n >= 0, '>= 0');
  const swingFxSeconds = num('swingFxSeconds', (n) => n > 0, 'positive');
  const hitFlashSeconds = num('hitFlashSeconds', (n) => n >= 0, '>= 0');
  const koAlpha = num('koAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const protectedBlinkHz = num('protectedBlinkHz', (n) => n > 0, 'positive');
  const hpBarWidthPx = num('hpBarWidthPx', (n) => n > 0, 'positive');
  const hpBarOffsetY = num('hpBarOffsetY', () => true, 'a number');
  const sprayFxAlpha = num('sprayFxAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const sprayCloudAlpha = num('sprayCloudAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const sprayCloudFadeSeconds = num('sprayCloudFadeSeconds', (n) => n >= 0, '>= 0');
  const fxBurstSeconds = num('fxBurstSeconds', (n) => n > 0, 'positive');
  const damageNumberSeconds = num('damageNumberSeconds', (n) => n > 0, 'positive');
  const damageNumberRisePx = num('damageNumberRisePx', (n) => n >= 0, '>= 0');
  const heldWeaponReachPx = num('heldWeaponReachPx', (n) => n >= 0, '>= 0');
  const heldWeaponLiftPx = num('heldWeaponLiftPx', () => true, 'a number');
  const heldWeaponScale = num('heldWeaponScale', (n) => n > 0, 'positive');
  const heldSwingSeconds = num('heldSwingSeconds', (n) => n > 0, 'positive');
  const heldUseKickPx = num('heldUseKickPx', (n) => n >= 0, '>= 0');
  const koStarsOffsetY = num('koStarsOffsetY', () => true, 'a number');
  const koStarsSpinHz = num('koStarsSpinHz', (n) => n > 0, 'positive');
  const hudHpWarnFraction = num('hudHpWarnFraction', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const hudHpLowFraction = num('hudHpLowFraction', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const hudWeaponFlashSeconds = num('hudWeaponFlashSeconds', (n) => n > 0, 'positive');
  const wantedIconOffsetY = num('wantedIconOffsetY', () => true, 'a number');
  const forkliftLightBlinkHz = num('forkliftLightBlinkHz', (n) => n > 0, 'positive');
  const forkliftBeepHearingPx = num('forkliftBeepHearingPx', (n) => n >= 0, '>= 0');
  const sfxHearingPx = num('sfxHearingPx', (n) => n >= 0, '>= 0');
  const customerGaspMinGapSeconds = num('customerGaspMinGapSeconds', (n) => n >= 0, '>= 0');
  if (issues.length > 0) throw new Error(`Invalid render-config.json:\n  - ${issues.join('\n  - ')}`);
  return Object.freeze({
    cameraZoom,
    cameraLerp,
    cameraCutPx,
    maxFrameSeconds,
    playerOriginY,
    menuPreviewScale,
    debugZoneAlpha,
    debugWallAlpha,
    spectatorCycleSeconds,
    interpolationDelayMs,
    snapDistancePx,
    disconnectedAlpha,
    nameplateOffsetY,
    carriedItemGapPx,
    itemOutlinePx,
    vanOutlinePx,
    playerOutlinePx,
    teamRingWidthPx,
    teamRingHeightPx,
    teamRingOffsetY,
    teamRingFillAlpha,
    teamNameplateAlpha,
    jokeTwinkleSeconds,
    hudMiniRows,
    hudFeedLines,
    hudFeedSeconds,
    hudFeedNearPx,
    hudTimerWarnSeconds,
    hudArrowMarginPx,
    hudArrowHoverPx,
    hudArrowAvoidPx,
    hudArrowMinFromCentrePx,
    swingFxSeconds,
    hitFlashSeconds,
    koAlpha,
    protectedBlinkHz,
    hpBarWidthPx,
    hpBarOffsetY,
    sprayFxAlpha,
    sprayCloudAlpha,
    sprayCloudFadeSeconds,
    fxBurstSeconds,
    damageNumberSeconds,
    damageNumberRisePx,
    heldWeaponReachPx,
    heldWeaponLiftPx,
    heldWeaponScale,
    heldSwingSeconds,
    heldUseKickPx,
    koStarsOffsetY,
    koStarsSpinHz,
    hudHpWarnFraction,
    hudHpLowFraction,
    hudWeaponFlashSeconds,
    wantedIconOffsetY,
    forkliftLightBlinkHz,
    forkliftBeepHearingPx,
    sfxHearingPx,
    customerGaspMinGapSeconds,
  });
}

export const renderConfig: RenderConfig = parseRenderConfig(raw);
