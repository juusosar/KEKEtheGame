import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { gridWithBlocked, placeStockCart, rectCovers, rectTiles } from './stockCart';
import { gridFrom } from './testGrid';

const rows = ['#######', '#.....#', '#.....#', '#######'];

describe('stock carts', () => {
  it('rectCovers and rectTiles agree', () => {
    const rect = { tx: 2, ty: 1, w: 2, h: 1 };
    expect(rectTiles(rect)).toEqual([
      { tx: 2, ty: 1 },
      { tx: 3, ty: 1 },
    ]);
    expect(rectCovers(rect, 3, 1)).toBe(true);
    expect(rectCovers(rect, 4, 1)).toBe(false);
    expect(rectCovers(rect, 2, 2)).toBe(false);
  });

  it('gridWithBlocked adds solid tiles live and keeps the rest of the grid', () => {
    const base = gridFrom(rows);
    let on = false;
    const grid = gridWithBlocked(base, (tx, ty) => on && tx === 2 && ty === 1);
    expect(grid.width).toBe(base.width);
    expect(grid.isSolid(2, 1)).toBe(false);
    on = true;
    expect(grid.isSolid(2, 1)).toBe(true);
    expect(grid.isSolid(0, 0)).toBe(true);
    expect(base.isSolid(2, 1)).toBe(false);
  });

  it('parks next to the stocker on free floor only', () => {
    const grid = gridFrom(rows);
    for (let seed = 1; seed < 20; seed++) {
      const rect = placeStockCart(
        grid,
        { stand: { tx: 3, ty: 1 }, lengthTiles: 2, occupied: () => false },
        createRng(seed),
      );
      if (!rect) throw new Error('expected a cart');
      for (const { tx, ty } of rectTiles(rect)) {
        expect(grid.isSolid(tx, ty)).toBe(false);
        expect(tx === 3 && ty === 1).toBe(false);
      }
    }
    // Only east is free when west is occupied and the rows above/below are too short or walls.
    const east = placeStockCart(
      grid,
      { stand: { tx: 3, ty: 1 }, lengthTiles: 2, occupied: (tx) => tx < 3 },
      createRng(1),
    );
    expect(east).toEqual({ tx: 4, ty: 1, w: 2, h: 1 });
    expect(
      placeStockCart(grid, { stand: { tx: 3, ty: 1 }, lengthTiles: 2, occupied: () => true }, createRng(1)),
    ).toBeNull();
  });
});
