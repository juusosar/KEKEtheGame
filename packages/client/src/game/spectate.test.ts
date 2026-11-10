import { describe, expect, it } from 'vitest';
import { SpectatorCycle, spectateCandidates } from './spectate';

describe('spectateCandidates', () => {
  it('lists online players in the round by join order, without the viewer', () => {
    const players = [
      { sessionId: 'c', joinOrder: 2, spectator: false, connected: true },
      { sessionId: 'me', joinOrder: 4, spectator: true, connected: true },
      { sessionId: 'a', joinOrder: 0, spectator: false, connected: true },
      { sessionId: 'away', joinOrder: 1, spectator: false, connected: false },
      { sessionId: 'other', joinOrder: 3, spectator: true, connected: true },
    ];
    expect(spectateCandidates(players, 'me')).toEqual(['a', 'c']);
  });
});

describe('SpectatorCycle', () => {
  it('follows the first player, then cycles on a timer and wraps around', () => {
    const cycle = new SpectatorCycle(5);
    const ids = ['a', 'b', 'c'];
    expect(cycle.update(ids, 0)).toBe('a');
    expect(cycle.update(ids, 4.9)).toBe('a');
    expect(cycle.update(ids, 0.1)).toBe('b');
    expect(cycle.update(ids, 5)).toBe('c');
    expect(cycle.update(ids, 5)).toBe('a');
  });

  it('skips on demand and restarts the timer', () => {
    const cycle = new SpectatorCycle(5);
    const ids = ['a', 'b'];
    cycle.update(ids, 4);
    expect(cycle.next(ids)).toBe('b');
    expect(cycle.update(ids, 4)).toBe('b');
    expect(cycle.update(ids, 1)).toBe('a');
  });

  it('moves on to the next player in order when the watched one leaves', () => {
    const cycle = new SpectatorCycle(5);
    cycle.update(['a', 'b', 'c'], 0);
    cycle.next(['a', 'b', 'c']);
    expect(cycle.target).toBe('b');
    expect(cycle.update(['a', 'c'], 0)).toBe('c');
    // Last one in the list leaves: wrap to the first.
    expect(cycle.update(['a'], 0)).toBe('a');
  });

  it('keeps the same player when others join or leave around them', () => {
    const cycle = new SpectatorCycle(5);
    cycle.update(['a', 'b'], 0);
    cycle.next(['a', 'b']);
    expect(cycle.update(['x', 'a', 'b'], 1)).toBe('b');
    expect(cycle.update(['b'], 1)).toBe('b');
  });

  it('has no target with nobody to watch, and picks one up when someone appears', () => {
    const cycle = new SpectatorCycle(5);
    expect(cycle.update([], 1)).toBeNull();
    expect(cycle.next([])).toBeNull();
    expect(cycle.update(['a'], 0)).toBe('a');
    expect(cycle.update([], 0)).toBeNull();
  });

  it('rejects a non-positive cycle time', () => {
    expect(() => new SpectatorCycle(0)).toThrow();
  });
});
