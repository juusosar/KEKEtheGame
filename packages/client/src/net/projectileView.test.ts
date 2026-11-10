import { describe, expect, it } from 'vitest';
import { projectileDrawPosition, readProjectiles } from './projectileView';

describe('readProjectiles', () => {
  it('reads every projectile sorted by id, with defaults for missing fields', () => {
    const list = readProjectiles({
      projectiles: new Map<string, unknown>([
        [
          '3',
          { id: 3, weapon: 'soda_bottle', owner: 'a', x: 1, y: 2, vx: 320, vy: 0, radius: 8, areaRadius: 64 },
        ],
        ['1', { id: 1, weapon: 'egg_carton', owner: 'b', x: 5, y: 6, landed: true, areaRadius: 32 }],
        ['x', 'junk'],
      ]),
    });
    expect(list.map((p) => p.id)).toEqual([1, 3]);
    expect(list[0]).toMatchObject({ weapon: 'egg_carton', landed: true, vx: 0, areaRadius: 32 });
    expect(list[1]).toMatchObject({ owner: 'a', vx: 320, radius: 8, landed: false });
  });

  it('is empty for a state without projectiles', () => {
    expect(readProjectiles(null)).toEqual([]);
    expect(readProjectiles({})).toEqual([]);
  });
});

describe('projectileDrawPosition', () => {
  it('carries on along the velocity, capped', () => {
    const p = { x: 10, y: 20, vx: 100, vy: -50 };
    expect(projectileDrawPosition(p, 0.02, 0.1)).toEqual({ x: 12, y: 19 });
    expect(projectileDrawPosition(p, 1, 0.1)).toEqual({ x: 20, y: 15 });
    expect(projectileDrawPosition(p, -1, 0.1)).toEqual({ x: 10, y: 20 });
  });
});
