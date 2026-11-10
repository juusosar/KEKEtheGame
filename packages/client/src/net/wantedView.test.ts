import { describe, expect, it } from 'vitest';
import { readWanted } from './wantedView';

describe('readWanted', () => {
  it('lists only wanted players with their seconds left', () => {
    const state = {
      players: new Map<string, unknown>([
        ['a', { sessionId: 'a', wanted: true, wantedIn: 12 }],
        ['b', { sessionId: 'b', wanted: false, wantedIn: 0 }],
        ['c', { wanted: true }],
      ]),
    };
    const wanted = readWanted(state);
    expect([...wanted.keys()]).toEqual(['a', 'c']);
    expect(wanted.get('a')).toEqual({ wanted: true, seconds: 12 });
    expect(wanted.get('c')).toEqual({ wanted: true, seconds: 0 });
  });

  it('is empty for junk state', () => {
    expect(readWanted(null).size).toBe(0);
    expect(readWanted({ players: 3 }).size).toBe(0);
  });
});
