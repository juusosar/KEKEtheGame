import { getItemCatalogue, getWeaponCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { combatFeedLine, feedLine, type FeedContext } from './feed';

const names: Record<string, string> = { a: 'Juuso', b: 'Mikko' };
const ctx: FeedContext = { catalogue: getItemCatalogue('kespro'), nameOf: (id) => names[id] ?? id };
const voi = { id: 4, itemId: 'coffee_juhla_mokka', rarity: 'normal', x: 0, y: 0 };
const mopo = { id: 5, itemId: 'kurkkumopo', rarity: 'joke', x: 0, y: 0 };

describe('feedLine', () => {
  it('announces a stolen target', () => {
    expect(
      feedLine('pickup', { player: 'a', item: voi, kind: 'other_target', targetOwner: 'b' }, ctx),
    ).toEqual({
      kind: 'steal',
      text: 'Juuso stole Paulig Juhla Mokka 500 g from Mikko',
    });
  });

  it('announces a joke item haul in capitals', () => {
    expect(
      feedLine('pickup', { player: 'b', item: mopo, kind: 'own_target', targetOwner: null }, ctx),
    ).toEqual({
      kind: 'joke',
      text: 'Mikko is hauling a KURKKUMOPO',
    });
  });

  it('stays quiet for an ordinary pickup', () => {
    expect(feedLine('pickup', { player: 'a', item: voi, kind: 'loose', targetOwner: null }, ctx)).toBeNull();
  });

  it('announces deposits with their points', () => {
    expect(feedLine('deposit', { player: 'a', item: mopo, van: 0, points: 2, vanTotal: 3 }, ctx)?.text).toBe(
      'Juuso banked Kurkkumopo (+2)',
    );
  });

  it('ignores other events and malformed messages', () => {
    expect(feedLine('drop', { player: 'a', item: voi, reason: 'drop' }, ctx)).toBeNull();
    expect(feedLine('pickup', null, ctx)).toBeNull();
    expect(feedLine('pickup', { player: 'a' }, ctx)).toBeNull();
  });
});

describe('slip drops', () => {
  it('announces a slip and stays quiet for other drops', () => {
    expect(feedLine('drop', { player: 'a', item: voi, reason: 'slip' }, ctx)).toEqual({
      kind: 'slip',
      text: 'Juuso slipped on a banana peel and dropped Paulig Juhla Mokka 500 g',
    });
    expect(feedLine('drop', { player: 'a', item: voi, reason: 'drop' }, ctx)).toBeNull();
  });
});

describe('combatFeedLine', () => {
  const combatCtx = {
    weapons: getWeaponCatalogue(),
    me: 'a',
    nameOf: (id: string) => names[id] ?? id,
  };
  const player = (id: string) => ({ kind: 'player' as const, id });

  it('announces every KO with the weapon', () => {
    expect(
      combatFeedLine(
        'ko',
        { player: 'b', source: player('c'), weapon: 'frozen_salmon', respawnInSeconds: 3 },
        combatCtx,
      ),
    ).toEqual({ kind: 'ko', text: 'c knocked out Mikko with Frozen salmon' });
    expect(
      combatFeedLine('ko', { player: 'a', source: player('b'), weapon: null, respawnInSeconds: 3 }, combatCtx)
        ?.text,
    ).toBe('Mikko knocked you out');
    expect(
      combatFeedLine(
        'ko',
        { player: 'b', source: { kind: 'hazard', id: 'f1' }, weapon: null, respawnInSeconds: 3 },
        combatCtx,
      )?.text,
    ).toBe('Mikko got knocked out');
  });

  it('shows only hits we dealt or took, and merges repeats', () => {
    const mine = combatFeedLine(
      'hit',
      { source: player('a'), target: 'b', damage: 3, weapon: 'ketchup_bottle', hp: 97 },
      combatCtx,
    );
    expect(mine).toMatchObject({ kind: 'hit', text: 'You hit Mikko with Ketchup bottle (-3)' });
    expect(mine?.merge?.render(9)).toBe('You hit Mikko with Ketchup bottle (-9)');
    const taken = combatFeedLine(
      'hit',
      { source: player('b'), target: 'a', damage: 5, weapon: 'fists', hp: 95 },
      combatCtx,
    );
    expect(taken?.text).toBe('Mikko hit you with Fists (-5)');
    expect(
      combatFeedLine(
        'hit',
        { source: player('b'), target: 'c', damage: 5, weapon: 'fists', hp: 95 },
        combatCtx,
      ),
    ).toBeNull();
    expect(
      combatFeedLine(
        'hit',
        { source: player('a'), target: 'b', damage: 0, weapon: 'banana_peels', hp: 95 },
        combatCtx,
      ),
    ).toBeNull();
  });
});
