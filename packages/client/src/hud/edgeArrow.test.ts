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

describe('placeArrow with HUD panels to avoid', () => {
  // A minimap-like box in the bottom-right corner and a scoreboard at the top right.
  const minimap = { left: 580, top: 380, right: 784, bottom: 584 };
  const scores = { left: 548, top: 12, right: 788, bottom: 160 };
  const avoid = { rects: [minimap, scores], radius: 14, minFromCentre: 60 };

  const clear = (x: number, y: number): boolean =>
    [minimap, scores].every(
      (r) => x + 14 <= r.left || x - 14 >= r.right || y + 14 <= r.top || y - 14 >= r.bottom,
    );

  it('keeps the edge spot when no panel is in the way', () => {
    expect(placeArrow(size, { x: -900, y: 300 }, 40, 30, avoid)).toMatchObject({ x: 40, y: 300 });
  });

  it('slides back toward the centre off the minimap, still pointing the same way', () => {
    const at = placeArrow(size, { x: 1400, y: 1300 }, 40, 30, avoid);
    expect(clear(at.x, at.y)).toBe(true);
    expect(at.angle).toBeCloseTo(Math.PI / 4);
    // Still on the line from the centre toward the point.
    expect(at.x - 400).toBeCloseTo(at.y - 300);
    expect(at.onScreen).toBe(false);
  });

  it('slides off the scoreboard for a point up and to the right', () => {
    const at = placeArrow(size, { x: 2000, y: -1000 }, 40, 30, avoid);
    expect(clear(at.x, at.y)).toBe(true);
    expect(Math.hypot(at.x - 400, at.y - 300)).toBeGreaterThanOrEqual(60);
  });

  it('points at an on-screen item hidden under a panel from the nearest clear spot', () => {
    const at = placeArrow(size, { x: 680, y: 480 }, 40, 30, avoid);
    expect(at.onScreen).toBe(true);
    expect(clear(at.x, at.y)).toBe(true);
    // Aimed at the item, down and to the right.
    expect(at.angle).toBeGreaterThan(0);
    expect(at.angle).toBeLessThan(Math.PI / 2);
  });

  it('stays on the edge when the whole way is blocked', () => {
    const wall = { left: 0, top: 0, right: 800, bottom: 600 };
    const at = placeArrow(size, { x: 5000, y: 300 }, 40, 30, { ...avoid, rects: [wall] });
    expect(at).toMatchObject({ x: 760, y: 300 });
  });
});
