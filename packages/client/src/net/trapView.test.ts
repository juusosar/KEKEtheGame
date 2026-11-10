import { describe, expect, it } from 'vitest';
import { readTraps } from './trapView';

describe('readTraps', () => {
  it('reads synced peels sorted by id and tolerates missing state', () => {
    const traps = new Map<string, unknown>([
      ['7', { id: 7, weapon: 'banana_peels', owner: 'b', team: 2, x: 10, y: 20, armed: true }],
      ['3', { id: 3, weapon: 'banana_peels', owner: 'a', x: 1, y: 2 }],
      ['x', { id: 0 }],
    ]);
    expect(readTraps({ traps })).toEqual([
      { id: 3, weapon: 'banana_peels', owner: 'a', team: 0, x: 1, y: 2, armed: false },
      { id: 7, weapon: 'banana_peels', owner: 'b', team: 2, x: 10, y: 20, armed: true },
    ]);
    expect(readTraps(undefined)).toEqual([]);
    expect(readTraps({})).toEqual([]);
  });
});
