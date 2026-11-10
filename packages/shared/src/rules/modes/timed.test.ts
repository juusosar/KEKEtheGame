import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { phaseSeconds } from '../../lobby/phases';
import {
  isTimedRoundOver,
  rankByItemPoints,
  rankTimedRound,
  teamPointsFromVans,
  teamSideId,
  type TimedPlayerScore,
} from './timed';

const p = (id: string, itemPoints: number, team = 0): TimedPlayerScore => ({ id, itemPoints, team });
const places = (ranked: readonly { id: string; place: number }[]) =>
  ranked.map((r) => [r.id, r.place] as const);

describe('timed round length and end', () => {
  it('runs for timedRoundSeconds (180 s by default)', () => {
    const config = loadConfig();
    expect(config.timedRoundSeconds).toBe(180);
    expect(phaseSeconds('playing', 'timed', config)).toBe(180);
  });

  it('ends when the timer hits 0', () => {
    expect(isTimedRoundOver(180)).toBe(false);
    expect(isTimedRoundOver(0.01)).toBe(false);
    expect(isTimedRoundOver(0)).toBe(true);
    expect(isTimedRoundOver(-0.05)).toBe(true);
  });
});

describe('rankByItemPoints', () => {
  it('ranks by item points, highest first', () => {
    const ranked = rankByItemPoints([
      { id: 'a', itemPoints: 2 },
      { id: 'b', itemPoints: 5 },
      { id: 'c', itemPoints: 3 },
    ]);
    expect(places(ranked)).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('gives tied sides the higher placement and skips the next place', () => {
    const ranked = rankByItemPoints([
      { id: 'a', itemPoints: 5 },
      { id: 'b', itemPoints: 5 },
      { id: 'c', itemPoints: 3 },
      { id: 'd', itemPoints: 3 },
      { id: 'e', itemPoints: 3 },
      { id: 'f', itemPoints: 0 },
    ]);
    expect(places(ranked)).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['d', 3],
      ['e', 3],
      ['f', 6],
    ]);
  });

  it('counts item points, not item count: one joke item beats one normal item', () => {
    const ranked = rankByItemPoints([
      { id: 'normal', itemPoints: 1 },
      { id: 'joke', itemPoints: 2 },
    ]);
    expect(ranked[0]?.id).toBe('joke');
  });

  it('puts everyone first when nobody scored', () => {
    const ranked = rankByItemPoints([
      { id: 'a', itemPoints: 0 },
      { id: 'b', itemPoints: 0 },
    ]);
    expect(ranked.map((r) => r.place)).toEqual([1, 1]);
  });

  it('does not depend on input order', () => {
    const sides = [
      { id: 'x', itemPoints: 4 },
      { id: 'a', itemPoints: 4 },
      { id: 'm', itemPoints: 1 },
    ];
    expect(rankByItemPoints(sides)).toEqual(rankByItemPoints([...sides].reverse()));
    expect(rankByItemPoints(sides).map((r) => r.id)).toEqual(['a', 'x', 'm']);
  });

  it('handles no sides', () => {
    expect(rankByItemPoints([])).toEqual([]);
  });

  it('rejects duplicates and bad points', () => {
    expect(() =>
      rankByItemPoints([
        { id: 'a', itemPoints: 1 },
        { id: 'a', itemPoints: 2 },
      ]),
    ).toThrow(RangeError);
    expect(() => rankByItemPoints([{ id: 'a', itemPoints: -1 }])).toThrow(RangeError);
    expect(() => rankByItemPoints([{ id: 'a', itemPoints: Number.NaN }])).toThrow(RangeError);
    expect(() => rankByItemPoints([{ id: 'a', itemPoints: Infinity }])).toThrow(RangeError);
  });
});

describe('rankTimedRound, free-for-all', () => {
  it('ranks each player on their own deposits and ignores team numbers', () => {
    const result = rankTimedRound([p('a', 3, 1), p('b', 5, 1), p('c', 3, 2)], false);
    expect(places(result.standings)).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
    ]);
    expect(result.players).toEqual([
      { id: 'b', itemPoints: 5, place: 1, team: 0 },
      { id: 'a', itemPoints: 3, place: 2, team: 0 },
      { id: 'c', itemPoints: 3, place: 2, team: 0 },
    ]);
  });

  it('ranks a solo round', () => {
    const result = rankTimedRound([p('solo', 0)], false);
    expect(result.players).toEqual([{ id: 'solo', itemPoints: 0, place: 1, team: 0 }]);
  });
});

describe('rankTimedRound, teams', () => {
  it('ranks teams by the sum of their members, and members share the team place', () => {
    const result = rankTimedRound(
      [p('a', 1, 1), p('b', 3, 1), p('c', 5, 2), p('d', 0, 2), p('e', 1, 2)],
      true,
    );
    expect(result.standings).toEqual([
      { id: teamSideId(2), itemPoints: 6, place: 1 },
      { id: teamSideId(1), itemPoints: 4, place: 2 },
    ]);
    expect(result.players.map((pl) => [pl.id, pl.place, pl.itemPoints, pl.team])).toEqual([
      ['c', 1, 5, 2],
      ['d', 1, 0, 2],
      ['e', 1, 1, 2],
      ['a', 2, 1, 1],
      ['b', 2, 3, 1],
    ]);
  });

  it('gives both teams first place on a tie', () => {
    const result = rankTimedRound([p('a', 2, 1), p('b', 1, 2), p('c', 1, 2)], true);
    expect(result.standings.map((s) => s.place)).toEqual([1, 1]);
    expect(result.players.every((pl) => pl.place === 1)).toBe(true);
  });

  it('lets a player without a team compete on their own', () => {
    const result = rankTimedRound([p('a', 2, 1), p('b', 2, 1), p('loner', 3, 0)], true);
    expect(places(result.standings)).toEqual([
      [teamSideId(1), 1],
      ['loner', 2],
    ]);
  });

  it('rejects duplicate players and bad points', () => {
    expect(() => rankTimedRound([p('a', 1, 1), p('a', 1, 2)], true)).toThrow(RangeError);
    expect(() => rankTimedRound([p('a', -2, 1)], true)).toThrow(RangeError);
    expect(() => rankTimedRound([p('a', 1, 1)], true, new Map([[1, -1]]))).toThrow(RangeError);
  });

  it('takes team points from the van bank when given, so a member who left still counts (M3 review F3)', () => {
    // Team 1 banked 5 (3 of them by a member who has left); only 'a' (2 deposited) is still here.
    const banked = new Map([
      [1, 5],
      [2, 4],
    ]);
    const result = rankTimedRound([p('a', 2, 1), p('c', 4, 2), p('loner', 3, 0)], true, banked);
    expect(result.standings).toEqual([
      { id: teamSideId(1), itemPoints: 5, place: 1 },
      { id: teamSideId(2), itemPoints: 4, place: 2 },
      { id: 'loner', itemPoints: 3, place: 3 },
    ]);
    // Per-player item points stay personal.
    expect(result.players.find((pl) => pl.id === 'a')?.itemPoints).toBe(2);
    // A team missing from the map falls back to its members' sum; a team with nobody left is not ranked.
    const partial = rankTimedRound([p('a', 2, 1), p('b', 1, 1)], true, new Map([[2, 9]]));
    expect(partial.standings).toEqual([{ id: teamSideId(1), itemPoints: 3, place: 1 }]);
    // Teams off: the map is ignored.
    expect(rankTimedRound([p('a', 2, 1)], false, banked).standings).toEqual([
      { id: 'a', itemPoints: 2, place: 1 },
    ]);
  });
});

describe('teamPointsFromVans', () => {
  it('sums banked points per team and skips teamless vans', () => {
    expect(
      teamPointsFromVans([
        { team: 1, points: 3 },
        { team: 2, points: 4 },
        { team: 0, points: 7 },
        { team: 1, points: 1 },
      ]),
    ).toEqual(
      new Map([
        [1, 4],
        [2, 4],
      ]),
    );
  });
});
