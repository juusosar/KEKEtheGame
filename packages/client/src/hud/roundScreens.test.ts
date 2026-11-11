import { describe, expect, it } from 'vitest';
import { podiumSteps, readRoundScreen } from './roundScreens';

type P = Record<string, unknown>;
const player = (id: string, joinOrder: number, extra: P = {}): P => ({
  sessionId: id,
  nickname: id.toUpperCase(),
  color: '#ff0000',
  team: 0,
  joinOrder,
  spectator: false,
  connected: true,
  deposited: 0,
  place: 0,
  roundPoints: 0,
  sessionPoints: 0,
  sessionItemPoints: 0,
  sessionPlace: 0,
  ...extra,
});

function state(phase: string, players: P[], extra: P = {}, teams = false): P {
  return {
    code: 'ABCD',
    phase,
    hostId: 'a',
    settings: { mode: 'timed', roundsPerMap: 2, teams },
    secondsLeft: 2.4,
    round: 1,
    totalRounds: 2,
    players: Object.fromEntries(players.map((p) => [p['sessionId'], p])),
    ...extra,
  };
}

describe('readRoundScreen', () => {
  it('is nothing in the lobby and while playing', () => {
    expect(readRoundScreen(state('lobby', []), 'a')).toEqual({ kind: 'none' });
    expect(readRoundScreen(state('playing', [player('a', 0)]), 'a')).toEqual({ kind: 'none' });
    expect(readRoundScreen(undefined, 'a')).toEqual({ kind: 'none' });
  });

  it('shows the intro with whole seconds, round and mode in the countdown', () => {
    expect(readRoundScreen(state('countdown', [player('a', 0)]), 'a')).toEqual({
      kind: 'intro',
      seconds: 3,
      round: 1,
      totalRounds: 2,
      mode: 'timed',
    });
  });

  it('lists results by place, spectators left out, and says when it is the last round', () => {
    const model = readRoundScreen(
      state('roundResults', [
        player('a', 0, { place: 2, deposited: 3, roundPoints: 7, sessionPoints: 7 }),
        player('b', 1, { place: 1, deposited: 9, roundPoints: 10, sessionPoints: 10 }),
        player('c', 2, { spectator: true }),
        player('d', 3, { place: 2, deposited: 3, roundPoints: 7, sessionPoints: 7 }),
      ]),
      'a',
    );
    if (model.kind !== 'results') throw new Error(model.kind);
    expect(model.final).toBe(false);
    expect(model.seconds).toBe(3);
    expect(
      model.rows.map((r) => [r.id, r.place, r.deposited, r.roundPoints, r.sessionPoints, r.isMe]),
    ).toEqual([
      ['b', 1, 9, 10, 10, false],
      ['a', 2, 3, 7, 7, true],
      ['d', 2, 3, 7, 7, false],
    ]);
    expect(model.teamRows).toEqual([]);

    expect(model.items).toBe('deposited');

    const last = readRoundScreen(state('roundResults', [player('a', 0)], { round: 2 }), 'a');
    expect(last.kind === 'results' && last.final).toBe(true);
  });

  it('adds team rows with members when Teams is on', () => {
    const model = readRoundScreen(
      state(
        'roundResults',
        [
          player('a', 0, { team: 1, place: 2 }),
          player('b', 1, { team: 2, place: 1 }),
          player('c', 2, { team: 2, place: 1 }),
        ],
        {
          teams: {
            '1': { team: 1, place: 2, itemPoints: 4, roundPoints: 7, sessionPoints: 7 },
            '2': { team: 2, place: 1, itemPoints: 8, roundPoints: 10, sessionPoints: 10 },
          },
        },
        true,
      ),
      'a',
    );
    if (model.kind !== 'results') throw new Error(model.kind);
    expect(model.teamRows).toEqual([
      {
        team: 2,
        place: 1,
        itemPoints: 8,
        roundPoints: 10,
        sessionPoints: 10,
        sessionPlace: 0,
        members: ['B', 'C'],
        delivered: false,
        mine: false,
      },
      {
        team: 1,
        place: 2,
        itemPoints: 4,
        roundPoints: 7,
        sessionPoints: 7,
        sessionPlace: 0,
        members: ['A'],
        delivered: false,
        mine: true,
      },
    ]);
  });

  it('ranks the podium by session place: players, or teams plus teamless players', () => {
    const ffa = readRoundScreen(
      state('podium', [
        player('a', 0, { sessionPlace: 2, sessionPoints: 14 }),
        player('b', 1, { sessionPlace: 1, sessionPoints: 20 }),
      ]),
      'a',
    );
    if (ffa.kind !== 'podium') throw new Error(ffa.kind);
    expect(ffa.rows.map((r) => [r.id, r.place, r.points, r.mine])).toEqual([
      ['b', 1, 20, false],
      ['a', 2, 14, true],
    ]);

    const teams = readRoundScreen(
      state(
        'podium',
        [
          player('a', 0, { team: 1 }),
          player('b', 1, { team: 2 }),
          player('z', 2, { team: 0, sessionPlace: 3 }),
        ],
        {
          teams: {
            '1': { team: 1, sessionPlace: 2, sessionPoints: 7, sessionItemPoints: 4 },
            '2': { team: 2, sessionPlace: 1, sessionPoints: 10, sessionItemPoints: 8 },
          },
        },
        true,
      ),
      'a',
    );
    if (teams.kind !== 'podium') throw new Error(teams.kind);
    expect(teams.rows.map((r) => [r.id, r.place, r.mine])).toEqual([
      ['team:2', 1, false],
      ['team:1', 2, true],
      ['z', 3, false],
    ]);
  });
});

describe('sessions (M7-1)', () => {
  it('shows the running total and the session standing after each round', () => {
    const model = readRoundScreen(
      state(
        'roundResults',
        [
          player('a', 0, { place: 1, roundPoints: 10, sessionPoints: 17, sessionPlace: 2 }),
          player('b', 1, { place: 2, roundPoints: 7, sessionPoints: 17, sessionPlace: 1 }),
        ],
        { round: 2 },
      ),
      'a',
    );
    if (model.kind !== 'results') throw new Error(model.kind);
    expect(model.rows.map((r) => [r.id, r.sessionPoints, r.sessionPlace])).toEqual([
      ['a', 17, 2],
      ['b', 17, 1],
    ]);
  });

  it('shows items controlled in a Race without Teams, own deposits otherwise', () => {
    const raceState = (teams: boolean): P => ({
      ...state(
        'roundResults',
        [
          player('a', 0, { place: 2, van: 0, deposited: 4 }),
          player('b', 1, { place: 1, van: 1, deposited: 1 }),
        ],
        { vans: { '0': { van: 0, points: 4, controlled: 4 }, '1': { van: 1, points: 0, controlled: 7 } } },
        teams,
      ),
      settings: { mode: 'race', roundsPerMap: 1, teams },
    });
    const ffa = readRoundScreen(raceState(false), 'a');
    if (ffa.kind !== 'results') throw new Error(ffa.kind);
    expect(ffa.items).toBe('controlled');
    expect(ffa.rows.map((r) => [r.id, r.items, r.deposited])).toEqual([
      ['b', 7, 1],
      ['a', 4, 4],
    ]);
    // With Teams on the team row carries the items controlled; player rows stay own deposits.
    const teams = readRoundScreen(raceState(true), 'a');
    if (teams.kind !== 'results') throw new Error(teams.kind);
    expect(teams.items).toBe('deposited');
    expect(teams.rows.map((r) => r.items)).toEqual([1, 4]);
  });

  it('marks the player and the team that delivered the order box (M6 review F2)', () => {
    const raceState = (teams: boolean, winner: string): P => ({
      ...state(
        'roundResults',
        [
          player('a', 0, { place: 2, van: 0, deposited: 6, team: teams ? 1 : 0 }),
          player('b', 1, { place: 1, van: 1, deposited: 0, team: teams ? 2 : 0 }),
        ],
        {
          vans: { '0': { van: 0, points: 0, controlled: 0 }, '1': { van: 1, points: 0, controlled: 0 } },
          raceWinner: winner,
          raceStolen: true,
          teams: teams
            ? { '1': { team: 1, place: 2, itemPoints: 0 }, '2': { team: 2, place: 1, itemPoints: 0 } }
            : {},
        },
        teams,
      ),
      settings: { mode: 'race', roundsPerMap: 1, teams },
    });
    const ffa = readRoundScreen(raceState(false, 'b'), 'a');
    if (ffa.kind !== 'results') throw new Error(ffa.kind);
    expect(ffa.rows.map((r) => [r.id, r.delivered])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    const teams = readRoundScreen(raceState(true, 'b'), 'a');
    if (teams.kind !== 'results') throw new Error(teams.kind);
    expect(teams.teamRows.map((r) => [r.team, r.delivered])).toEqual([
      [2, true],
      [1, false],
    ]);
    const timeUp = readRoundScreen(raceState(false, ''), 'a');
    if (timeUp.kind !== 'results') throw new Error(timeUp.kind);
    expect(timeUp.rows.every((r) => !r.delivered)).toBe(true);
  });

  it('marks podium sides whose place the item points decided, and gives colours and members', () => {
    const model = readRoundScreen(
      state('podium', [
        player('a', 0, { sessionPlace: 1, sessionPoints: 23, sessionItemPoints: 5, color: '#111111' }),
        player('b', 1, { sessionPlace: 3, sessionPoints: 22, sessionItemPoints: 4 }),
        player('c', 2, { sessionPlace: 3, sessionPoints: 22, sessionItemPoints: 4 }),
        player('d', 3, { sessionPlace: 2, sessionPoints: 23, sessionItemPoints: 4 }),
        player('e', 4, { sessionPlace: 5, sessionPoints: 10, sessionItemPoints: 1 }),
      ]),
      'e',
    );
    if (model.kind !== 'podium') throw new Error(model.kind);
    expect(model.totalRounds).toBe(2);
    expect(model.rows.map((r) => [r.id, r.place, r.tieBroken])).toEqual([
      ['a', 1, true],
      ['d', 2, true],
      ['b', 3, false],
      ['c', 3, false],
      ['e', 5, false],
    ]);
    expect(model.rows[0]?.color).toBe('#111111');
    const { steps, rest } = podiumSteps(model.rows);
    expect(steps.map((s) => s.map((r) => r.id))).toEqual([['a'], ['d'], ['b', 'c']]);
    expect(rest.map((r) => [r.id, r.mine])).toEqual([['e', true]]);

    const teams = readRoundScreen(
      state(
        'podium',
        [player('a', 0, { team: 1 }), player('b', 1, { team: 1 })],
        { teams: { '1': { team: 1, sessionPlace: 1, sessionPoints: 10, sessionItemPoints: 2 } } },
        true,
      ),
      'a',
    );
    if (teams.kind !== 'podium') throw new Error(teams.kind);
    expect(teams.rows).toMatchObject([{ id: 'team:1', color: '#E53935', members: ['A', 'B'], mine: true }]);
  });

  it('puts unranked sides and places past 3rd below the steps; empty steps stay empty', () => {
    const { steps, rest } = podiumSteps([
      {
        id: 'x',
        name: 'X',
        team: 0,
        color: '',
        members: [],
        place: 1,
        points: 1,
        itemPoints: 0,
        tieBroken: false,
        mine: false,
      },
      {
        id: 'y',
        name: 'Y',
        team: 0,
        color: '',
        members: [],
        place: 0,
        points: 0,
        itemPoints: 0,
        tieBroken: false,
        mine: false,
      },
    ]);
    expect(steps.map((s) => s.length)).toEqual([1, 0, 0]);
    expect(rest.map((r) => r.id)).toEqual(['y']);
  });
});

describe('race results banner (M6-3)', () => {
  const race = (extra: P, teams = false, me = 'a'): ReturnType<typeof readRoundScreen> =>
    readRoundScreen(
      {
        ...state(
          'roundResults',
          [player('a', 0, { place: 1, team: 1 }), player('b', 1, { place: 2, team: 1 })],
          extra,
          teams,
        ),
        settings: { mode: 'race', roundsPerMap: 1, teams },
      },
      me,
    );

  it('names the deliverer, and whether the box was stolen', () => {
    expect(race({ raceWinner: 'b', raceStolen: false })).toMatchObject({
      race: { outcome: 'delivered', winner: 'b', name: 'B', mine: false },
    });
    expect(race({ raceWinner: 'a', raceStolen: true })).toMatchObject({
      race: { outcome: 'stolen', winner: 'a', name: 'A', mine: true },
    });
  });

  it('counts a teammate’s delivery as ours with Teams on', () => {
    expect(race({ raceWinner: 'b' }, true)).toMatchObject({ race: { mine: true } });
  });

  it('says time is up when nobody delivered, and is absent in Timed', () => {
    expect(race({ raceWinner: '' })).toMatchObject({ race: { outcome: 'timeUp', winner: '', mine: false } });
    expect(readRoundScreen(state('roundResults', [player('a', 0)]), 'a')).toMatchObject({ race: null });
  });
});
