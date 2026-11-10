// Public entry point of @keke/shared. Pure TS only: no Phaser, no Colyseus, no DOM.

/** Clamps `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) is greater than max (${max})`);
  }
  return Math.min(max, Math.max(min, value));
}
