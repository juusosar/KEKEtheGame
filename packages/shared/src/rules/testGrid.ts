// Test helper: builds a CollisionGrid / MovementMap from ASCII rows ('#' = wall, '.' = floor).
import type { CollisionGrid } from './collision';
import type { FloorZone, MovementMap } from './movement';

export function gridFrom(rows: readonly string[], tileSize = 32): CollisionGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    width,
    height,
    tileSize,
    isSolid: (tx, ty) => rows[ty]?.[tx] === '#',
  };
}

/** A map with one optional zone covering the pixel rectangle [x0, x1) × [y0, y1). */
export function mapFrom(
  rows: readonly string[],
  zone?: { rect: [number, number, number, number]; floor: FloorZone },
  tileSize = 32,
): MovementMap {
  return {
    collision: gridFrom(rows, tileSize),
    zoneAt(x, y) {
      if (!zone) return undefined;
      const [x0, y0, x1, y1] = zone.rect;
      return x >= x0 && x < x1 && y >= y0 && y < y1 ? zone.floor : undefined;
    },
  };
}
