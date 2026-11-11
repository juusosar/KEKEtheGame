// Reads the pushable shopping carts of the synced GameState (`carts`; P2-5) for the cart renderer, movement
// prediction (pushes replayed on a copy) and the debug hook. Read defensively like the other views.
import { CART_DIRS, newCart, type CartBody, type CartDir } from '@keke/shared';
import { isBag, mapEntries, num, str } from './lobbyView';

export interface CartView {
  /** From 1, the map's cart_spawns order. */
  id: number;
  x: number;
  y: number;
  /** The way the nose points (art frame `cart_<dir>`). */
  dir: CartDir;
}

function cartDir(value: string): CartDir {
  return (CART_DIRS as readonly string[]).includes(value) ? (value as CartDir) : 'left';
}

/** The carts of this round, sorted by id. */
export function readCarts(state: unknown): CartView[] {
  const out: CartView[] = [];
  if (!isBag(state)) return out;
  for (const [key, value] of mapEntries(state['carts'])) {
    if (!isBag(value)) continue;
    const id = num(value, 'id', Number(key) || 0);
    if (id <= 0) continue;
    out.push({ id, x: num(value, 'x'), y: num(value, 'y'), dir: cartDir(str(value, 'dir', 'left')) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Fresh mutable bodies at rest for the shared push rules (prediction never rolls carts itself). */
export function cartBodies(carts: readonly CartView[]): CartBody[] {
  return carts.map((c) => newCart(c.id, c, c.dir));
}
