// Reads the projectiles of the synced GameState (M4-3 schema) for the placeholder projectile renderer and
// the debug hook. Read defensively, like worldView: a missing field falls back to its schema default.
import { bool, isBag, mapEntries, num, str } from './lobbyView';

export interface ProjectileView {
  id: number;
  /** Weapon id that threw it. */
  weapon: string;
  /** Thrower's session id. */
  owner: string;
  /** Server position at the last patch (the impact point once landed). */
  x: number;
  y: number;
  /** Pixels per second; 0 once landed. */
  vx: number;
  vy: number;
  radius: number;
  /** Splash / burst radius, 0 = none. */
  areaRadius: number;
  landed: boolean;
}

/** Projectiles in the state, sorted by id. */
export function readProjectiles(state: unknown): ProjectileView[] {
  if (!isBag(state)) return [];
  const out: ProjectileView[] = [];
  for (const [key, value] of mapEntries(state['projectiles'])) {
    if (!isBag(value)) continue;
    const id = num(value, 'id', Number(key) || 0);
    if (id <= 0) continue;
    out.push({
      id,
      weapon: str(value, 'weapon'),
      owner: str(value, 'owner'),
      x: num(value, 'x'),
      y: num(value, 'y'),
      vx: num(value, 'vx'),
      vy: num(value, 'vy'),
      radius: num(value, 'radius'),
      areaRadius: num(value, 'areaRadius'),
      landed: bool(value, 'landed'),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Where to draw a projectile `elapsed` seconds after the patch that placed it: carried on along its
 * velocity (it flies in a straight line), at most `maxAhead` seconds, so a late patch never overshoots far.
 */
export function projectileDrawPosition(
  p: Pick<ProjectileView, 'x' | 'y' | 'vx' | 'vy'>,
  elapsed: number,
  maxAhead: number,
): { x: number; y: number } {
  const t = Math.min(Math.max(0, elapsed), maxAhead);
  return { x: p.x + p.vx * t, y: p.y + p.vy * t };
}
