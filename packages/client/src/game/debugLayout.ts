// Pure layout helpers for the ?debug=1 overlay, kept out of the scene so they can be unit-tested.
import type { Zone } from '@keke/shared';

/** Approximate label box in world pixels (10 px monospace, one line). */
export const DEBUG_LABEL_HEIGHT = 14;
const CHAR_WIDTH = 6;

export interface LabelPlacement {
  readonly id: string;
  /** Top centre of the label in world pixels. */
  readonly x: number;
  readonly y: number;
}

/**
 * Places one label per zone at the centre of its bounds, then pushes any label that would
 * overlap an earlier one down by a line until it is clear. Nested zones (e.g. `behind_counter`
 * inside `meat_fish`) therefore never print on top of each other.
 */
export function placeZoneLabels(zones: readonly Zone[]): LabelPlacement[] {
  const placed: { x: number; y: number; halfWidth: number; id: string }[] = [];
  for (const zone of zones) {
    const b = zone.bounds;
    const x = (b.minX + b.maxX) / 2;
    let y = (b.minY + b.maxY) / 2 - DEBUG_LABEL_HEIGHT / 2;
    const halfWidth = (zone.id.length * CHAR_WIDTH) / 2 + 2;
    const clashes = (): boolean =>
      placed.some(
        (p) => Math.abs(p.x - x) < p.halfWidth + halfWidth && Math.abs(p.y - y) < DEBUG_LABEL_HEIGHT,
      );
    while (clashes()) y += DEBUG_LABEL_HEIGHT;
    placed.push({ x, y, halfWidth, id: zone.id });
  }
  return placed.map(({ id, x, y }) => ({ id, x, y }));
}
