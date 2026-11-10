// Reads the store workers and stock carts of the synced GameState (`npcs`, `stockCarts`; M5-3) for the
// NPC renderer (M5-7), the debug hook and movement prediction (carts block like walls).
// Read defensively, like lobbyView: a missing field falls back to its schema default.
import { rectTiles, type TileRect } from '@keke/shared';
import { bool, isBag, mapEntries, num, str } from './lobbyView';

export interface NpcView {
  /** `<type>_<n>`, e.g. 'stocker_2'. */
  id: string;
  /** npcs.json id; the catalogue gives the sprite. */
  type: string;
  behaviour: string;
  x: number;
  y: number;
  /** Facing, radians. */
  aim: number;
  moving: boolean;
  hp: number;
  /** 0 = invulnerable (forklift). */
  maxHp: number;
  alive: boolean;
  respawnIn: number;
  stunned: boolean;
  /** Behaviour state: 'idle', 'ko', stocker 'walk' | 'stock' | 'angry', ... */
  mode: string;
  /** Player the NPC is after, '' when none. */
  target: string;
}

export interface StockCartView extends TileRect {
  id: number;
  /** Stocker that parked it. */
  npc: string;
}

/** NPCs in the round, sorted by id. */
export function readNpcs(state: unknown): NpcView[] {
  const out: NpcView[] = [];
  if (!isBag(state)) return out;
  for (const [key, value] of mapEntries(state['npcs'])) {
    if (!isBag(value)) continue;
    out.push({
      id: str(value, 'id', key),
      type: str(value, 'type'),
      behaviour: str(value, 'behaviour'),
      x: num(value, 'x'),
      y: num(value, 'y'),
      aim: num(value, 'aim'),
      moving: bool(value, 'moving'),
      hp: num(value, 'hp'),
      maxHp: num(value, 'maxHp'),
      alive: bool(value, 'alive', true),
      respawnIn: num(value, 'respawnIn'),
      stunned: bool(value, 'stunned'),
      mode: str(value, 'mode', 'idle'),
      target: str(value, 'target'),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Stock carts parked right now, sorted by id. */
export function readStockCarts(state: unknown): StockCartView[] {
  const out: StockCartView[] = [];
  if (!isBag(state)) return out;
  for (const [key, value] of mapEntries(state['stockCarts'])) {
    if (!isBag(value)) continue;
    const id = num(value, 'id', Number(key) || 0);
    if (id <= 0) continue;
    out.push({
      id,
      npc: str(value, 'npc'),
      tx: num(value, 'tx'),
      ty: num(value, 'ty'),
      w: num(value, 'w', 1),
      h: num(value, 'h', 1),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Tile keys (`ty * width + tx`) the carts cover, for a fast `gridWithBlocked` lookup. */
export function cartTileKeys(carts: readonly TileRect[], width: number): Set<number> {
  const keys = new Set<number>();
  for (const cart of carts) for (const { tx, ty } of rectTiles(cart)) keys.add(ty * width + tx);
  return keys;
}
