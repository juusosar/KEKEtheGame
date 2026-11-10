// Stock carts (§8, M5-3): a stocker sometimes parks a cart in the aisle next to the shelf it restocks.
// A cart is a straight run of whole tiles that blocks movement like a wall until it is wheeled away.
// Shared so the server and the client's movement prediction block the same tiles (`gridWithBlocked`).
import type { Rng } from '../rng';
import { isSolidTile, type CollisionGrid } from './collision';

/** A rectangle of whole tiles: top-left tile (tx, ty), `w` × `h` tiles. */
export interface TileRect {
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
}

/** True when tile (tx, ty) lies inside `rect`. */
export function rectCovers(rect: TileRect, tx: number, ty: number): boolean {
  return tx >= rect.tx && tx < rect.tx + rect.w && ty >= rect.ty && ty < rect.ty + rect.h;
}

/** The tiles of `rect`, row by row. */
export function rectTiles(rect: TileRect): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (let ty = rect.ty; ty < rect.ty + rect.h; ty++) {
    for (let tx = rect.tx; tx < rect.tx + rect.w; tx++) out.push({ tx, ty });
  }
  return out;
}

/**
 * A view of `grid` where `blocked(tx, ty)` tiles are solid too. Every other property (including a map
 * grid's `solid` bytes, which stay the walls only) comes from `grid`, so a `MapCollisionGrid` stays one.
 * The view reads `blocked` on every call: carts that come and go need no rebuild.
 */
export function gridWithBlocked<G extends CollisionGrid>(
  grid: G,
  blocked: (tx: number, ty: number) => boolean,
): G {
  return Object.assign(Object.create(Object.getPrototypeOf(grid) as object) as G, grid, {
    isSolid: (tx: number, ty: number) => grid.isSolid(tx, ty) || blocked(tx, ty),
  });
}

export interface StockCartPlacement {
  /** Tile the stocker stands on. */
  readonly stand: { readonly tx: number; readonly ty: number };
  /** Cart length in tiles (npcs.json `stockCart.lengthTiles`). */
  readonly lengthTiles: number;
  /** Tiles that must stay free: bodies standing there, other carts, zones carts may not use. */
  readonly occupied: (tx: number, ty: number) => boolean;
}

/**
 * Where a stocker standing on `stand` parks a cart: a straight run of `lengthTiles` floor tiles right next
 * to it (east, west, south or north of the stocker, lying along that side), on walkable tiles that are not
 * `occupied`. One of the free options is picked with `rng`; null when none is free.
 */
export function placeStockCart(
  grid: CollisionGrid,
  placement: StockCartPlacement,
  rng: Rng,
): TileRect | null {
  const { stand, lengthTiles: n, occupied } = placement;
  if (n < 1) return null;
  const options: TileRect[] = [
    // Beside the stocker, lying along the aisle in both axes and on both sides.
    { tx: stand.tx + 1, ty: stand.ty, w: n, h: 1 },
    { tx: stand.tx - n, ty: stand.ty, w: n, h: 1 },
    { tx: stand.tx, ty: stand.ty + 1, w: 1, h: n },
    { tx: stand.tx, ty: stand.ty - n, w: 1, h: n },
  ];
  const free = options.filter((rect) =>
    rectTiles(rect).every(({ tx, ty }) => !isSolidTile(grid, tx, ty) && !occupied(tx, ty)),
  );
  return free.length === 0 ? null : rng.pick(free);
}
