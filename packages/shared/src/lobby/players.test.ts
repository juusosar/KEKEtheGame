import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { balanceTeams, canStart, pickHost, shuffleTeams, teamForJoiner, type RosterEntry } from './players';

const entry = (id: string, joinOrder: number, team = 0): RosterEntry => ({ id, joinOrder, team });

describe('pickHost', () => {
  it('picks the longest-connected player', () => {
    expect(pickHost([entry('b', 5), entry('a', 2), entry('c', 9)])).toBe('a');
  });
  it('can skip the leaving host and returns null when empty', () => {
    expect(pickHost([entry('a', 0), entry('b', 1)], 'a')).toBe('b');
    expect(pickHost([])).toBeNull();
  });
});

describe('teams', () => {
  it('puts a joiner on the smaller team, team 1 on a tie', () => {
    expect(teamForJoiner([])).toBe(1);
    expect(teamForJoiner([entry('a', 0, 1)])).toBe(2);
    expect(teamForJoiner([entry('a', 0, 1), entry('b', 1, 2)])).toBe(1);
  });

  it('balances, keeping early joiners where they are', () => {
    const teams = balanceTeams([
      entry('a', 0, 1),
      entry('b', 1, 1),
      entry('c', 2, 1),
      entry('d', 3, 1),
      entry('e', 4),
    ]);
    const sizes = [...teams.values()].reduce((acc, t) => ((acc[t - 1] += 1), acc), [0, 0]);
    expect(Math.abs((sizes[0] ?? 0) - (sizes[1] ?? 0))).toBeLessThanOrEqual(1);
    expect(teams.get('a')).toBe(1);
    expect(teams.get('d')).toBe(2);
    expect(teams.size).toBe(5);
  });

  it('shuffles into a balanced split, deterministic for a seed', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const first = shuffleTeams(ids, createRng(11));
    expect([...first.values()].filter((t) => t === 1)).toHaveLength(4);
    expect(shuffleTeams(ids, createRng(11))).toEqual(first);
  });
});

describe('canStart', () => {
  it('needs everyone ready and at least one player; spectators do not count', () => {
    expect(canStart([])).toBe(false);
    expect(canStart([{ ready: true, spectator: false }])).toBe(true);
    expect(
      canStart([
        { ready: true, spectator: false },
        { ready: false, spectator: false },
      ]),
    ).toBe(false);
    expect(
      canStart([
        { ready: true, spectator: false },
        { ready: false, spectator: true },
      ]),
    ).toBe(true);
    expect(canStart([{ ready: false, spectator: true }])).toBe(false);
  });
});
