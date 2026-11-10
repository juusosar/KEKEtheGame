import { getItemCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { formatClock, miniRows, readHud, type HudContext, type HudPlayerRow } from './hudState';

const ctx: HudContext = {
  catalogue: getItemCatalogue('kespro'),
  vanSlots: [
    { x: 100, y: 200 },
    { x: 300, y: 200 },
  ],
};

type P = Record<string, unknown>;
const player = (id: string, joinOrder: number, extra: P = {}): P => ({
  sessionId: id,
  nickname: id.toUpperCase(),
  color: '#ff0000',
  hat: 'cap',
  team: 0,
  joinOrder,
  spectator: false,
  connected: true,
  van: joinOrder,
  carrying: 0,
  target: 0,
  deposited: 0,
  ...extra,
});

function state(players: P[], extra: P = {}): P {
  return {
    code: 'ABCD',
    phase: 'playing',
    hostId: 'a',
    settings: { mode: 'timed', roundsPerMap: 1, teams: false },
    secondsLeft: 125,
    players: Object.fromEntries(players.map((p) => [p['sessionId'], p])),
    items: {
      '7': {
        id: 7,
        itemId: 'coffee_juhla_mokka',
        rarity: 'normal',
        state: 'target',
        x: 40,
        y: 50,
        owner: 'a',
      },
      '9': { id: 9, itemId: 'kurkkumopo', rarity: 'joke', state: 'carried', x: 0, y: 0, carrier: 'b' },
    },
    vans: {},
    ...extra,
  };
}

describe('readHud', () => {
  it('shows our target card and points the arrow at it', () => {
    const hud = readHud(state([player('a', 0, { target: 7 })]), 'a', ctx);
    expect(hud.target).toMatchObject({
      id: 7,
      itemId: 'coffee_juhla_mokka',
      name: 'Paulig Juhla Mokka 500 g',
      zone: 'dry_goods',
      sprite: 'coffee_juhla_mokka',
    });
    expect(hud.carried).toBeNull();
    expect(hud.arrow).toEqual({ kind: 'target', at: { x: 40, y: 50 } });
  });

  it('points at our van while carrying and fills the carry slot', () => {
    const hud = readHud(state([player('a', 0), player('b', 1, { carrying: 9, target: 7 })]), 'b', ctx);
    expect(hud.carried).toMatchObject({ id: 9, name: 'Kurkkumopo', rarity: 'joke', zone: 'any' });
    // No target card while carrying (§3.1: own target picked up → no target).
    expect(hud.target).toBeNull();
    expect(hud.arrow).toEqual({ kind: 'van', at: { x: 300, y: 200 } });
  });

  it('has no arrow without a target or a van', () => {
    const hud = readHud(state([player('a', 0, { van: -1, carrying: 9 })]), 'a', ctx);
    expect(hud.arrow).toBeNull();
    expect(readHud(state([player('a', 0)]), 'a', ctx).arrow).toBeNull();
  });

  it('runs the timer only while playing', () => {
    expect(readHud(state([player('a', 0)]), 'a', ctx).secondsLeft).toBe(125);
    expect(readHud(state([player('a', 0)], { phase: 'countdown' }), 'a', ctx).secondsLeft).toBeNull();
  });

  it('ranks players by deposits, ties share the higher place, spectators left out', () => {
    const hud = readHud(
      state([
        player('a', 0, { deposited: 2 }),
        player('b', 1, { deposited: 5 }),
        player('c', 2, { deposited: 2 }),
        player('d', 3, { spectator: true, deposited: 9 }),
      ]),
      'c',
      ctx,
    );
    expect(hud.rows.map((r) => [r.id, r.place, r.points, r.isMe])).toEqual([
      ['b', 1, 5, false],
      ['a', 2, 2, false],
      ['c', 2, 2, true],
    ]);
    expect(hud.teamRows).toEqual([]);
    expect(hud.hasSession).toBe(false);
  });

  it('sums teams and gives members the team place', () => {
    const hud = readHud(
      state(
        [
          player('a', 0, { team: 1, deposited: 1 }),
          player('b', 1, { team: 2, deposited: 3 }),
          player('c', 2, { team: 1, deposited: 1 }),
        ],
        { settings: { mode: 'timed', roundsPerMap: 1, teams: true } },
      ),
      'a',
      ctx,
    );
    expect(hud.teamRows).toEqual([
      { team: 2, points: 3, place: 1 },
      { team: 1, points: 2, place: 2 },
    ]);
    expect(hud.rows.find((r) => r.id === 'a')?.place).toBe(2);
  });

  it('takes team points from the van bank, so a member who left still counts (M3 review F3)', () => {
    // Team 1's van banked 4, 3 of them by a member who has left; only 'a' (1 deposited) is still here.
    const hud = readHud(
      state([player('a', 0, { team: 1, deposited: 1 }), player('b', 1, { team: 2, deposited: 3 })], {
        settings: { mode: 'timed', roundsPerMap: 1, teams: true },
        vans: { '0': { van: 0, team: 1, points: 4 }, '1': { van: 1, team: 2, points: 3 } },
      }),
      'a',
      ctx,
    );
    expect(hud.teamRows).toEqual([
      { team: 1, points: 4, place: 1 },
      { team: 2, points: 3, place: 2 },
    ]);
    expect(hud.rows.find((r) => r.id === 'a')).toMatchObject({ points: 1, place: 1 });
  });

  it('reads session totals once the round flow sends them', () => {
    const hud = readHud(state([player('a', 0, { sessionPoints: 17, sessionItemPoints: 6 })]), 'a', ctx);
    expect(hud.hasSession).toBe(true);
    expect(hud.rows[0]).toMatchObject({ sessionPoints: 17, sessionItemPoints: 6 });
  });

  it('shows no card or carry for a spectator', () => {
    const hud = readHud(state([player('a', 0, { spectator: true, target: 7 })]), 'a', ctx);
    expect(hud.spectator).toBe(true);
    expect(hud.target).toBeNull();
    expect(hud.arrow).toBeNull();
  });

  it('survives an empty state before the first patch', () => {
    const hud = readHud(undefined, 'a', ctx);
    expect(hud).toMatchObject({ synced: false, target: null, carried: null, arrow: null, rows: [] });
  });

  it('falls back to the id for an item missing from the catalogue', () => {
    const s = state([player('a', 0, { target: 3 })]);
    (s['items'] as P)['3'] = { id: 3, itemId: 'mystery', rarity: 'normal', x: 1, y: 2 };
    expect(readHud(s, 'a', ctx).target).toMatchObject({ name: 'mystery', desc: '', zone: '' });
  });
});

describe('miniRows', () => {
  const rows = (n: number, me: number): HudPlayerRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      nickname: `P${i}`,
      color: '',
      team: 0,
      points: n - i,
      place: i + 1,
      isMe: i === me,
      connected: true,
      sessionPoints: null,
      sessionItemPoints: null,
    }));

  it('keeps the top rows and adds ours when we are below them', () => {
    expect(miniRows(rows(8, 6), 5).map((r) => r.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p6']);
  });

  it('does not repeat our row when we are in the top', () => {
    expect(miniRows(rows(8, 2), 5).map((r) => r.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });
});

describe('formatClock', () => {
  it('formats m:ss and rounds up', () => {
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(9.2)).toBe('0:10');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('readHud in race mode (M6-3)', () => {
  const raceCtx: HudContext = { ...ctx, office: { x: 3696, y: 1280 }, raceQuota: 6 };
  const race = (players: P[], items: P, vans: P, teams = false): P => ({
    ...state(players),
    settings: { mode: 'race', roundsPerMap: 1, teams },
    items,
    vans,
  });
  const box = (carrier: string, packedVan: number): P => ({
    '5': { id: 5, itemId: 'order_box', state: 'carried', x: 0, y: 0, carrier, packedVan, points: 6 },
  });

  it('shows our van’s quota progress', () => {
    const hud = readHud(
      race([player('a', 0, { van: 0 })], {}, { '0': { van: 0, points: 4, team: 0, controlled: 4 } }),
      'a',
      raceCtx,
    );
    expect(hud.mode).toBe('race');
    expect(hud.race).toEqual({ points: 4, quota: 6, controlled: 4, carryingBox: false, stolen: false });
  });

  it('points the arrow at the office while carrying a box and names it in the carry slot', () => {
    const hud = readHud(
      race([player('a', 0, { van: 0, carrying: 5 })], box('a', 0), {
        '0': { van: 0, points: 0, controlled: 6 },
      }),
      'a',
      raceCtx,
    );
    expect(hud.arrow).toEqual({ kind: 'office', at: { x: 3696, y: 1280 } });
    expect(hud.carried).toMatchObject({
      itemId: 'order_box',
      name: 'Order box',
      atlas: 'order_box',
      sprite: 'order_box',
      box: { packedVan: 0, points: 6 },
    });
    expect(hud.race).toMatchObject({ carryingBox: true, stolen: false });
  });

  it('flags a stolen box', () => {
    const hud = readHud(race([player('a', 0, { van: 0, carrying: 5 })], box('a', 1), {}), 'a', raceCtx);
    expect(hud.race).toMatchObject({ carryingBox: true, stolen: true });
  });

  it('ranks the scoreboard by items each van controls, not by deposits', () => {
    const hud = readHud(
      race(
        [player('a', 0, { van: 0, deposited: 6 }), player('b', 1, { van: 1, deposited: 2 })],
        {},
        {
          '0': { van: 0, points: 0, team: 0, controlled: 0 },
          '1': { van: 1, points: 2, team: 0, controlled: 2 },
        },
      ),
      'a',
      raceCtx,
    );
    expect(hud.rows.map((r) => [r.id, r.place, r.points])).toEqual([
      ['b', 1, 2],
      ['a', 2, 0],
    ]);
  });

  it('ranks teams by their shared van’s control', () => {
    const hud = readHud(
      race(
        [player('a', 0, { van: 0, team: 1 }), player('b', 1, { van: 1, team: 2 })],
        {},
        {
          '0': { van: 0, points: 1, team: 1, controlled: 1 },
          '1': { van: 1, points: 0, team: 2, controlled: 6 },
        },
        true,
      ),
      'a',
      raceCtx,
    );
    expect(hud.teamRows).toEqual([
      { team: 2, points: 6, place: 1 },
      { team: 1, points: 1, place: 2 },
    ]);
  });

  it('has no race model in Timed', () => {
    expect(readHud(state([player('a', 0)]), 'a', raceCtx).race).toBeNull();
  });
});
