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
  });
}

export const renderConfig: RenderConfig = parseRenderConfig(raw);
