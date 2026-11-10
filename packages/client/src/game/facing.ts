// Which way a character faces and which animation it plays. Pure, so it is unit-tested without Phaser.
import type { Vec2 } from '@keke/shared';

export type Facing = 'down' | 'up' | 'left' | 'right';

/**
 * Facing from a move vector: the dominant axis wins, ties go to the horizontal axis so diagonal
 * walking shows the side view. No movement keeps the previous facing.
 */
export function facingFromMove(move: Vec2, previous: Facing): Facing {
  const ax = Math.abs(move.x);
  const ay = Math.abs(move.y);
  if (ax === 0 && ay === 0) return previous;
  if (ax >= ay) return move.x < 0 ? 'left' : 'right';
  return move.y < 0 ? 'up' : 'down';
}

/** Animation key in the §11.1 format `<sheet>/<anim>_<dir>`, e.g. `body/walk_down`. */
export function animKey(sheet: string, walking: boolean, facing: Facing): string {
  return `${sheet}/${walking ? 'walk' : 'idle'}_${facing}`;
}
