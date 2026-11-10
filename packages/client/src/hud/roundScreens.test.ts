import { describe, expect, it } from 'vitest';
import { readRoundScreen } from './roundScreens';

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
        members: ['B', 'C'],
        mine: false,
      },
      { team: 1, place: 2, itemPoints: 4, roundPoints: 7, sessionPoints: 7, members: ['A'], mine: true },
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
