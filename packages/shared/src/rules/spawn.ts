// Where players start (§3: every player spawns at their van). Shared so the server places players and
// the client's offline Game scene uses the same rule.
import type { Vec2 } from '../types';
import { aabbOverlapsSolid, type CollisionGrid, type HalfSize } from './collision';

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

/** What spawning needs from a map. `MapModel` from shared/src/map satisfies this shape. */
export interface SpawnMap {
  readonly collision: CollisionGrid;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Van slots sorted by index (`loadMap` sorts them). */
  readonly vanSlots: readonly Vec2[];
}

/**
 * Spawn position for the player in van slot `slot` (0-based, wraps when there are more players than
 * slots): the nearest free spot to that van's centre, or to the map centre when the map has no vans.
 * The server passes `PlayerState.van` from `assignVans` (rules/vans.ts).
 */
export function vanSpawn(map: SpawnMap, slot: number, half: HalfSize): Vec2 {
  const count = map.vanSlots.length;
  const van = count > 0 ? map.vanSlots[((slot % count) + count) % count] : undefined;
  const preferred = van ?? { x: map.widthPx / 2, y: map.heightPx / 2 };
  return findSpawn(map.collision, preferred, half);
}
