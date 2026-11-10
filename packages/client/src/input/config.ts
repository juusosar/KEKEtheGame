import raw from './input-config.json';

/**
 * Input tunables (§21: every tunable number lives in a data file). Client-only, so they sit next to
 * the InputManager instead of in the shared config.json.
 */
export interface InputConfig {
  /** Left-stick radial deadzone, 0..1. Below it the stick counts as centred. */
  stickDeadzone: number;
  /** Right-stick radial deadzone, 0..1. Below it the stick is idle and aim falls back (§13.3). */
  aimStickDeadzone: number;
  /** Analog trigger value (0..1) at which LT / RT count as held. */
  triggerThreshold: number;
  /** Full width of the aim-assist cone in degrees (§13.3: 30°). */
  aimAssistConeDegrees: number;
  /** Mouse movement (px) in one frame that counts as keyboard/mouse activity for device switching. */
  mouseActivityPixels: number;
}

export const inputConfig: InputConfig = raw;
