// Client-only render tunables (§21: tunable numbers live in data files). Game rules stay in shared/config.json.
import raw from './render-config.json';

export interface RenderConfig {
  /** Integer camera zoom (§11.1: 2×). */
  readonly cameraZoom: number;
  /** Camera follow smoothing, 0..1 (1 = locked to the player). */
  readonly cameraLerp: number;
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
  /** Period of the joke-item twinkle (§10.1: "a little sparkle so everyone notices them"), seconds. */
  readonly jokeTwinkleSeconds: number;
  /** Rows in the HUD mini scoreboard before our own row is added (§13.2: top 5 + you). */
  readonly hudMiniRows: number;
  /** Event feed lines kept on screen at once. */
  readonly hudFeedLines: number;
  /** Seconds an event feed line stays. */
  readonly hudFeedSeconds: number;
  /** The round timer turns to its warning style at or below this many seconds. */
  readonly hudTimerWarnSeconds: number;
  /** Target arrow distance from the screen edge, CSS px. */
  readonly hudArrowMarginPx: number;
  /** How far the target arrow floats above an on-screen target, CSS px. */
  readonly hudArrowHoverPx: number;
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
  const jokeTwinkleSeconds = num('jokeTwinkleSeconds', (n) => n > 0, 'positive');
  const hudMiniRows = num('hudMiniRows', (n) => Number.isInteger(n) && n >= 1, 'an integer >= 1');
  const hudFeedLines = num('hudFeedLines', (n) => Number.isInteger(n) && n >= 1, 'an integer >= 1');
  const hudFeedSeconds = num('hudFeedSeconds', (n) => n > 0, 'positive');
  const hudTimerWarnSeconds = num('hudTimerWarnSeconds', (n) => n >= 0, '>= 0');
  const hudArrowMarginPx = num('hudArrowMarginPx', (n) => n >= 0, '>= 0');
  const hudArrowHoverPx = num('hudArrowHoverPx', (n) => n >= 0, '>= 0');
  const swingFxSeconds = num('swingFxSeconds', (n) => n > 0, 'positive');
  const hitFlashSeconds = num('hitFlashSeconds', (n) => n >= 0, '>= 0');
  const koAlpha = num('koAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const protectedBlinkHz = num('protectedBlinkHz', (n) => n > 0, 'positive');
  const hpBarWidthPx = num('hpBarWidthPx', (n) => n > 0, 'positive');
  const hpBarOffsetY = num('hpBarOffsetY', () => true, 'a number');
  const sprayFxAlpha = num('sprayFxAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const sprayCloudAlpha = num('sprayCloudAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const sprayCloudFadeSeconds = num('sprayCloudFadeSeconds', (n) => n >= 0, '>= 0');
  if (issues.length > 0) throw new Error(`Invalid render-config.json:\n  - ${issues.join('\n  - ')}`);
  return Object.freeze({
    cameraZoom,
    cameraLerp,
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
    jokeTwinkleSeconds,
    hudMiniRows,
    hudFeedLines,
    hudFeedSeconds,
    hudTimerWarnSeconds,
    hudArrowMarginPx,
    hudArrowHoverPx,
    swingFxSeconds,
    hitFlashSeconds,
    koAlpha,
    protectedBlinkHz,
    hpBarWidthPx,
    hpBarOffsetY,
    sprayFxAlpha,
    sprayCloudAlpha,
    sprayCloudFadeSeconds,
  });
}

export const renderConfig: RenderConfig = parseRenderConfig(raw);
