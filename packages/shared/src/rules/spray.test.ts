import { describe, expect, it } from 'vitest';
import { getWeaponCatalogue } from '../weapons';
import { clearLine, sprayCloud, sprayPushPx, sprayTargets, sprayTickDue } from './spray';
import { gridFrom } from './testGrid';

const weapons = getWeaponCatalogue();
function sprayOf(id: string) {
  const def = weapons.require(id);
  if (def.behaviour !== 'spray') throw new Error(`${id} is not a spray`);
  return def.spray;
}
const ketchup = sprayOf('ketchup_bottle');
const extinguisher = sprayOf('fire_extinguisher');

// 8 × 3 tiles of 32 px, one wall tile at column 4 of the middle row.
const grid = gridFrom(['........', '....#...', '........']);

describe('clearLine', () => {
  it('is clear across open floor and blocked by a wall tile', () => {
    expect(clearLine(grid, { x: 16, y: 16 }, { x: 240, y: 16 })).toBe(true);
    expect(clearLine(grid, { x: 16, y: 48 }, { x: 240, y: 48 })).toBe(false);
  });
});

describe('sprayTargets', () => {
  const origin = { x: 40, y: 80 };
  it('ketchup reaches bodies in its short 30° cone, nearest first', () => {
    const ids = sprayTargets(
      origin,
      0,
      [
        { id: 'far', x: 40 + 70, y: 80 },
        { id: 'near', x: 40 + 30, y: 80 },
        { id: 'out_of_range', x: 40 + 120, y: 80 },
        { id: 'side', x: 40 + 30, y: 80 + 40 },
      ],
      ketchup,
      10,
    );
    expect(ids).toEqual(['near', 'far']);
  });

  it('the extinguisher cone is wider and longer', () => {
    const ids = sprayTargets(
      origin,
      0,
      [
        { id: 'side', x: 40 + 60, y: 80 + 35 },
        { id: 'far', x: 40 + 120, y: 80 },
      ],
      extinguisher,
      10,
    );
    expect(ids).toEqual(['side', 'far']);
  });

  it('does not reach through a wall when given the grid', () => {
    const behind = [{ id: 'b', x: 176, y: 48 }];
    const from = { x: 100, y: 48 };
    expect(sprayTargets(from, 0, behind, extinguisher, 10)).toEqual(['b']);
    expect(sprayTargets(from, 0, behind, extinguisher, 10, grid)).toEqual([]);
  });
});

describe('spray ticks', () => {
  it('the first tick fires at once, then one per tickSeconds', () => {
    expect(sprayTickDue(undefined, 3)).toBe(true);
    expect(sprayTickDue(3.25, 3.2)).toBe(false);
    // Round-clock sums of 0.05 s steps land a hair under the exact time.
    expect(sprayTickDue(3.25, 0.05 * 65 - 1e-12)).toBe(true);
  });

  it('push per tick is pushPxPerSecond × tickSeconds (ketchup has none)', () => {
    expect(sprayPushPx(extinguisher)).toBe(240 * 0.25);
    expect(sprayPushPx(ketchup)).toBe(0);
  });
});

describe('sprayCloud', () => {
  it('the extinguisher leaves a cloud whose far edge is the end of the cone', () => {
    const c = sprayCloud({ x: 0, y: 0 }, Math.PI / 2, extinguisher);
    const cloud = extinguisher.visionCloud;
    if (!c || !cloud) throw new Error('expected a cloud');
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(extinguisher.rangePx - cloud.radiusPx, 6);
    expect(c.radiusPx).toBe(cloud.radiusPx);
    expect(c.seconds).toBe(cloud.seconds);
  });

  it('ketchup leaves no cloud', () => {
    expect(sprayCloud({ x: 0, y: 0 }, 0, ketchup)).toBeNull();
  });
});
