// Where the target arrow sits on screen (§13.2: "at the screen edge pointing to your target").
// Pure geometry in CSS pixels: when the point is off screen the arrow sits on the edge of an inset
// rectangle along the line from the screen centre; when it is on screen it hovers above the point.
import type { Vec2 } from '@keke/shared';

export interface ArrowPlacement {
  x: number;
  y: number;
  /** Radians, 0 = pointing right (+x), clockwise on screen like InputFrame.aim. */
  angle: number;
  onScreen: boolean;
}

/**
 * @param size viewport size
 * @param point the destination in the same screen space
 * @param margin distance kept from the screen edge
 * @param hover how far above an on-screen point the arrow floats
 */
export function placeArrow(
  size: { width: number; height: number },
  point: Vec2,
  margin: number,
  hover: number,
): ArrowPlacement {
  const halfW = Math.max(0, size.width / 2 - margin);
  const halfH = Math.max(0, size.height / 2 - margin);
  const cx = size.width / 2;
  const cy = size.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;

  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
    // Pointing down at the item (or van) from just above it, kept inside the screen.
    return { x: point.x, y: Math.max(margin, point.y - hover), angle: Math.PI / 2, onScreen: true };
  }
  const sx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const sy = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(sx, sy);
  return { x: cx + dx * scale, y: cy + dy * scale, angle: Math.atan2(dy, dx), onScreen: false };
}
