// Where the target arrow sits on screen (§13.2: "at the screen edge pointing to your target").
// Pure geometry in CSS pixels: when the point is off screen the arrow sits on the edge of an inset
// rectangle along the line from the screen centre; when it is on screen it hovers above the point.
// Playtest 1 found the arrow under a HUD panel 69% of the time (the minimap, the carry card, the
// scoreboard), so panels are obstacles: the arrow slides back along the same line toward the centre
// until it is clear of every one of them, still pointing the same way.
import type { Vec2 } from '@keke/shared';

export interface ArrowPlacement {
  x: number;
  y: number;
  /** Radians, 0 = pointing right (+x), clockwise on screen like InputFrame.aim. */
  angle: number;
  onScreen: boolean;
}

/** A screen rectangle in CSS pixels (a HUD panel's bounding box). */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ArrowAvoid {
  /** Panels the arrow must not sit on. */
  rects: readonly ScreenRect[];
  /** Half the arrow's size plus a gap: how far its centre stays from a panel. */
  radius: number;
  /** The arrow never comes closer than this to the screen centre (where our player stands). */
  minFromCentre: number;
}

/** How finely the arrow walks back toward the centre looking for a clear spot, in CSS pixels. */
const STEP_PX = 4;

function overlaps(x: number, y: number, r: number, rects: readonly ScreenRect[]): boolean {
  for (const rect of rects) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
    if (x + r > rect.left && x - r < rect.right && y + r > rect.top && y - r < rect.bottom) return true;
  }
  return false;
}

/**
 * Moves `at` back along the line from the centre until it clears every panel; keeps it when it is
 * already clear, or when no clear spot exists farther out than `minFromCentre`.
 */
function clearOfPanels(centre: Vec2, at: Vec2, avoid: ArrowAvoid): Vec2 {
  if (!overlaps(at.x, at.y, avoid.radius, avoid.rects)) return at;
  const dx = at.x - centre.x;
  const dy = at.y - centre.y;
  const length = Math.hypot(dx, dy);
  for (let d = length - STEP_PX; d >= avoid.minFromCentre; d -= STEP_PX) {
    const x = centre.x + (dx * d) / length;
    const y = centre.y + (dy * d) / length;
    if (!overlaps(x, y, avoid.radius, avoid.rects)) return { x, y };
  }
  return at;
}

/**
 * @param size viewport size
 * @param point the destination in the same screen space
 * @param margin distance kept from the screen edge
 * @param hover how far above an on-screen point the arrow floats
 * @param avoid HUD panels to keep clear of (none = the plain edge placement)
 */
export function placeArrow(
  size: { width: number; height: number },
  point: Vec2,
  margin: number,
  hover: number,
  avoid?: ArrowAvoid,
): ArrowPlacement {
  const halfW = Math.max(0, size.width / 2 - margin);
  const halfH = Math.max(0, size.height / 2 - margin);
  const cx = size.width / 2;
  const cy = size.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const centre = { x: cx, y: cy };

  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
    // Pointing down at the item (or van) from just above it, kept inside the screen.
    const above = { x: point.x, y: Math.max(margin, point.y - hover) };
    const at = avoid ? clearOfPanels(centre, above, avoid) : above;
    if (at === above) return { x: above.x, y: above.y, angle: Math.PI / 2, onScreen: true };
    // The point is under a panel: point at it from the nearest clear spot on the way.
    return { x: at.x, y: at.y, angle: Math.atan2(point.y - at.y, point.x - at.x), onScreen: true };
  }
  const sx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const sy = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(sx, sy);
  const edge = { x: cx + dx * scale, y: cy + dy * scale };
  const at = avoid ? clearOfPanels(centre, edge, avoid) : edge;
  return { x: at.x, y: at.y, angle: Math.atan2(dy, dx), onScreen: false };
}
