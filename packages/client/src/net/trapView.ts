// Reads the banana peels of the synced GameState (`traps`, M4-5) for the peel renderer and the debug hook.
// Read defensively, like lobbyView: a missing field falls back to its schema default.
import { bool, isBag, mapEntries, num, str } from './lobbyView';

export interface TrapView {
  /** Unique within the round. */
  id: number;
  /** Weapon id that dropped it ('banana_peels'). */
  weapon: string;
  /** Session id of the thrower. */
  owner: string;
  /** Thrower's team (0 = no teams). */
  team: number;
  x: number;
  y: number;
  /** Past its arm delay: trips rivals. */
  armed: boolean;
}

/** Peels on the floor, sorted by id. */
export function readTraps(state: unknown): TrapView[] {
  const out: TrapView[] = [];
  if (!isBag(state)) return out;
  for (const [key, value] of mapEntries(state['traps'])) {
    if (!isBag(value)) continue;
    const id = num(value, 'id', Number(key) || 0);
    if (id <= 0) continue;
    out.push({
      id,
      weapon: str(value, 'weapon'),
      owner: str(value, 'owner'),
      team: num(value, 'team'),
      x: num(value, 'x'),
      y: num(value, 'y'),
      armed: bool(value, 'armed'),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}
