// Client-only render tunables (§21: tunable numbers live in data files). Game rules stay in shared/config.json.
import raw from './render-config.json';

export const HATS = ['chef', 'cap', 'beanie', 'hairnet', 'hardhat'] as const;
export type HatId = (typeof HATS)[number];

export interface RenderConfig {
  /** Integer camera zoom (§11.1: 2×). */
  readonly cameraZoom: number;
  /** Camera follow smoothing, 0..1 (1 = locked to the player). */
  readonly cameraLerp: number;
  /** Longest frame the local simulation steps in one go, so a stalled tab does not tunnel. */
  readonly maxFrameSeconds: number;
  /** Sprite origin Y (0..1): the frame row that sits on the player's position (centre of the hitbox). */
  readonly playerOriginY: number;
  /** Tint for the greyscale body until the Profile scene (M2-4) lets players pick one. */
  readonly defaultPlayerColor: string;
  readonly defaultHat: HatId;
  readonly debugZoneAlpha: number;
  readonly debugWallAlpha: number;
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
  const debugZoneAlpha = num('debugZoneAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const debugWallAlpha = num('debugWallAlpha', (n) => n >= 0 && n <= 1, 'in [0, 1]');
  const color = obj['defaultPlayerColor'];
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    issues.push('defaultPlayerColor: must be a #RRGGBB colour');
  }
  const hat = obj['defaultHat'];
  if (!HATS.includes(hat as HatId)) issues.push(`defaultHat: must be one of ${HATS.join(', ')}`);
  if (issues.length > 0) throw new Error(`Invalid render-config.json:\n  - ${issues.join('\n  - ')}`);
  return Object.freeze({
    cameraZoom,
    cameraLerp,
    maxFrameSeconds,
    playerOriginY,
    defaultPlayerColor: color as string,
    defaultHat: hat as HatId,
    debugZoneAlpha,
    debugWallAlpha,
  });
}

export const renderConfig: RenderConfig = parseRenderConfig(raw);
