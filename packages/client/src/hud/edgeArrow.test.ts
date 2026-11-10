import { describe, expect, it } from 'vitest';
import { placeArrow } from './edgeArrow';

const size = { width: 800, height: 600 };

describe('placeArrow', () => {
  it('hovers above an on-screen point, pointing down', () => {
    expect(placeArrow(size, { x: 300, y: 200 }, 40, 30)).toEqual({
      x: 300,
      y: 170,
      angle: Math.PI / 2,
      onScreen: true,
    });
  });

  it('keeps the hover inside the top margin', () => {
    expect(placeArrow(size, { x: 300, y: 50 }, 40, 30).y).toBe(40);
  });

  it('sits on the right edge for a point far to the right', () => {
    const at = placeArrow(size, { x: 5000, y: 300 }, 40, 30);
    expect(at).toMatchObject({ x: 760, y: 300, angle: 0, onScreen: false });
  });

  it('sits on the top edge for a point straight up', () => {
    const at = placeArrow(size, { x: 400, y: -900 }, 40, 30);
    expect(at.x).toBeCloseTo(400);
    expect(at.y).toBeCloseTo(40);
    expect(at.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('clamps a diagonal point to whichever edge it crosses first', () => {
    const at = placeArrow(size, { x: 1400, y: 1300 }, 40, 30);
    // Direction (1000, 1000) from the centre: the bottom edge (260 px away) comes before the right (360).
    expect(at.y).toBeCloseTo(560);
    expect(at.x).toBeCloseTo(660);
    expect(at.angle).toBeCloseTo(Math.PI / 4);
  });
});
