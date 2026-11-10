import { TEAM_COLORS } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import type { WorldPlayerView } from '../net/worldView';
import {
  carriedItemCentreY,
  itemOutlineColor,
  nameplateLift,
  playerOutlineColor,
  twinkle,
  vanFrame,
  vanOutlineColor,
} from './worldLayout';

const a = { id: 'a', color: '#111111', team: 1 };
const b = { id: 'b', color: '#222222', team: 2 };
const roster = new Map([
  ['a', a],
  ['b', b],
]);
const slot = (van: number): WorldPlayerView => ({ van, carrying: 0, target: 0, deposited: 0 });

describe('outlines', () => {
  it('uses the player colour, or the team colour with Teams on (§4.3)', () => {
    expect(playerOutlineColor(a, false)).toBe('#111111');
    expect(playerOutlineColor(a, true)).toBe(TEAM_COLORS[0]);
    expect(playerOutlineColor(b, true)).toBe(TEAM_COLORS[1]);
    expect(playerOutlineColor({ ...a, team: 0 }, true)).toBe('#111111');
  });

  it('outlines only targets, in the owner colour (§3.1)', () => {
    expect(itemOutlineColor({ state: 'target', owner: 'b' }, roster, false)).toBe('#222222');
    expect(itemOutlineColor({ state: 'target', owner: 'b' }, roster, true)).toBe(TEAM_COLORS[1]);
    expect(itemOutlineColor({ state: 'loose', owner: '' }, roster, false)).toBeUndefined();
    expect(itemOutlineColor({ state: 'carried', owner: '' }, roster, false)).toBeUndefined();
    expect(itemOutlineColor({ state: 'target', owner: 'gone' }, roster, false)).toBeUndefined();
  });

  it("frames a van in its player's colour, or its team's", () => {
    const players = new Map([
      ['a', slot(0)],
      ['b', slot(3)],
    ]);
    expect(
      vanOutlineColor({ van: 3, points: 0, team: 0, controlled: 0 }, { players, teams: false }, [a, b]),
    ).toBe('#222222');
    expect(
      vanOutlineColor({ van: 5, points: 0, team: 0, controlled: 0 }, { players, teams: false }, [a, b]),
    ).toBeUndefined();
    expect(
      vanOutlineColor({ van: 1, points: 0, team: 2, controlled: 0 }, { players, teams: true }, [a, b]),
    ).toBe(TEAM_COLORS[1]);
  });
});

describe('placement', () => {
  it('names van frames by the painted slot number', () => {
    expect(vanFrame(0)).toBe('slot_1');
    expect(vanFrame(15)).toBe('slot_16');
  });

  it('puts a carried item above the head and lifts the nameplate over it', () => {
    expect(carriedItemCentreY(100, 24, 20)).toBe(68);
    expect(nameplateLift(24, 20, 24)).toBe(20);
    expect(nameplateLift(32, 20, 24)).toBe(28);
    expect(nameplateLift(4, 2, 24)).toBe(0);
  });

  it('twinkles once per period', () => {
    expect(twinkle(0, 1)).toBe(0);
    expect(twinkle(0.1, 1)).toBeCloseTo(1);
    expect(twinkle(0.5, 1)).toBe(0);
    expect(twinkle(1.1, 1)).toBeCloseTo(1);
    expect(twinkle(-0.9, 1)).toBeCloseTo(1);
  });
});
