// Public entry point of @keke/shared. Pure TS only: no Phaser, no Colyseus, no DOM.

export { Rng, createRng, type Weighted } from './rng';
export { Button, buttonsOf, isPressed, type ButtonName, type InputFrame, type Vec2 } from './types';
export { ConfigError, configSchema, formatIssues, loadConfig, type GameConfig } from './config';

/** Clamps `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) is greater than max (${max})`);
  }
  return Math.min(max, Math.max(min, value));
}
