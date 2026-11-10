import { describe, expect, it } from 'vitest';
import { cartTileKeys, readNpcs, readStockCarts } from './npcView';

describe('npcView', () => {
  it('reads NPCs and carts defensively and sorted', () => {
    const state = {
      npcs: new Map<string, unknown>([
        ['stocker_2', { id: 'stocker_2', type: 'stocker', hp: 60, maxHp: 60, mode: 'walk' }],
        ['stocker_1', { id: 'stocker_1', type: 'stocker', alive: false, mode: 'ko', respawnIn: 12 }],
      ]),
      stockCarts: new Map<string, unknown>([['3', { id: 3, npc: 'stocker_1', tx: 4, ty: 5, w: 2, h: 1 }]]),
    };
    const npcs = readNpcs(state);
    expect(npcs.map((n) => n.id)).toEqual(['stocker_1', 'stocker_2']);
    expect(npcs[0]).toMatchObject({ alive: false, mode: 'ko', respawnIn: 12 });
    expect(npcs[1]).toMatchObject({ alive: true, hp: 60, target: '' });
    const carts = readStockCarts(state);
    expect(carts).toEqual([{ id: 3, npc: 'stocker_1', tx: 4, ty: 5, w: 2, h: 1 }]);
    expect([...cartTileKeys(carts, 100)]).toEqual([504, 505]);
    expect(readNpcs(null)).toEqual([]);
  });
});
