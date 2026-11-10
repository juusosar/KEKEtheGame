// Where the local player starts. M1 has no van assignment yet (M3-4), so the player spawns at van slot 1.
import { aabbOverlapsSolid, type CollisionGrid, type HalfSize, type Vec2 } from '@keke/shared';

/**
 * The free position nearest to `preferred` where a body of size `half` touches no wall: `preferred`
 * itself when it is free, otherwise the closest free tile centre (searched in growing rings).
 * Throws when the whole map is solid.
 */
export function findSpawn(grid: CollisionGrid, preferred: Vec2, half: HalfSize): Vec2 {
  if (!aabbOverlapsSolid(grid, preferred, half)) return { x: preferred.x, y: preferred.y };
  const ts = grid.tileSize;
  const ptx = Math.floor(preferred.x / ts);
  const pty = Math.floor(preferred.y / ts);
  const maxRing = Math.max(grid.width, grid.height);
  for (let ring = 1; ring <= maxRing; ring++) {
    let best: Vec2 | undefined;
    let bestDist = Infinity;
    for (let ty = pty - ring; ty <= pty + ring; ty++) {
      for (let tx = ptx - ring; tx <= ptx + ring; tx++) {
        if (Math.max(Math.abs(tx - ptx), Math.abs(ty - pty)) !== ring) continue;
        const pos = { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
        if (aabbOverlapsSolid(grid, pos, half)) continue;
        const dist = Math.hypot(pos.x - preferred.x, pos.y - preferred.y);
        if (dist < bestDist) {
          best = pos;
          bestDist = dist;
        }
      }
    }
    if (best) return best;
  }
  throw new Error('findSpawn: no free tile on the map');
}
