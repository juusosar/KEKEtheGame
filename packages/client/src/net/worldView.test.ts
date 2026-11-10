import { describe, expect, it } from 'vitest';
import { readWorld } from './worldView';

describe('readWorld', () => {
  it('reads items, vans, the per-player item fields and the teams setting', () => {
    const world = readWorld({
      settings: { teams: true },
      items: new Map([
        [
          '2',
          { id: 2, itemId: 'kurkkumopo', rarity: 'joke', state: 'loose', x: 5, y: 6, owner: '', carrier: '' },
        ],
        [
          '1',
          { id: 1, itemId: 'flour_myllyn_paras', rarity: 'normal', state: 'target', x: 1, y: 2, owner: 'a' },
        ],
      ]),
      vans: { '1': { van: 1, points: 3, team: 2 }, '0': { van: 0, points: 0, team: 1 } },
      players: { a: { sessionId: 'a', van: 0, carrying: 2, target: 1, deposited: 4 } },
    });
    expect(world.teams).toBe(true);
    expect(world.items.map((i) => i.id)).toEqual([1, 2]);
    expect(world.items[0]).toEqual({
      id: 1,
      itemId: 'flour_myllyn_paras',
      rarity: 'normal',
      state: 'target',
      x: 1,
      y: 2,
      owner: 'a',
      carrier: '',
      packedVan: -1,
      points: 0,
    });
    expect(world.items[1]?.rarity).toBe('joke');
    expect(world.vans).toEqual([
      { van: 0, points: 0, team: 1, controlled: 0 },
      { van: 1, points: 3, team: 2, controlled: 3 },
    ]);
    expect(world.players.get('a')).toEqual({ van: 0, carrying: 2, target: 1, deposited: 4 });
  });

  it('falls back to schema defaults and skips junk', () => {
    expect(readWorld(undefined)).toMatchObject({ items: [], vans: [], teams: false });
    const world = readWorld({
      items: { '3': { state: 'flying' }, x: 'junk', '0': { id: 0 } },
      players: { b: {} },
    });
    expect(world.items).toEqual([
      {
        id: 3,
        itemId: '',
        rarity: 'normal',
        state: 'target',
        x: 0,
        y: 0,
        owner: '',
        carrier: '',
        packedVan: -1,
        points: 0,
      },
    ]);
    expect(world.players.get('b')).toEqual({ van: -1, carrying: 0, target: 0, deposited: 0 });
  });

  it('reads the race fields: order box packing van and points, van control (M6-3)', () => {
    const world = readWorld({
      items: { '4': { id: 4, itemId: 'order_box', state: 'carried', carrier: 'a', packedVan: 1, points: 7 } },
      vans: { '1': { van: 1, points: 2, team: 0, controlled: 9 } },
    });
    expect(world.items[0]).toMatchObject({ itemId: 'order_box', packedVan: 1, points: 7 });
    expect(world.vans[0]).toEqual({ van: 1, points: 2, team: 0, controlled: 9 });
  });
});
