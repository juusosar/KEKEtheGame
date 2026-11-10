import { getItemCatalogue, getWeaponCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { combatFeedLine, feedLine, npcFeedLine, type FeedContext } from './feed';

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

  it('announces a forklift run-over drop (M5-5)', () => {
    expect(feedLine('drop', { player: 'b', item: voi, reason: 'forklift' }, ctx)).toEqual({
      kind: 'runover',
      text: 'Mikko got run over by a forklift and dropped Paulig Juhla Mokka 500 g',
    });
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

describe('store workers and Wanted in the feed (M5-7)', () => {
  const npcCtx = {
    weapons: getWeaponCatalogue(),
    me: 'a',
    nameOf: (id: string) => names[id] ?? id,
    npcName: (id: string) => (id.startsWith('security') ? 'security guard' : 'stocker'),
  };
  const npc = (id: string) => ({ kind: 'npc' as const, id });
  const player = (id: string) => ({ kind: 'player' as const, id });

  it('names the worker that hit or knocked us out', () => {
    expect(
      combatFeedLine(
        'hit',
        { source: npc('security_1'), target: 'a', damage: 15, weapon: null, hp: 85 },
        npcCtx,
      )?.text,
    ).toBe('Security guard hit you (-15)');
    expect(
      combatFeedLine(
        'ko',
        { player: 'a', source: npc('stocker_2'), weapon: null, respawnInSeconds: 3 },
        npcCtx,
      )?.text,
    ).toBe('Stocker knocked you out');
    expect(
      combatFeedLine(
        'hit',
        { source: { kind: 'hazard', id: 'forklift_1' }, target: 'a', damage: 25, weapon: null, hp: 75 },
        { ...npcCtx, npcName: () => 'forklift' },
      )?.text,
    ).toBe('Forklift hit you (-25)');
  });

  it("announces a worker we knocked out, not other people's", () => {
    expect(
      npcFeedLine(
        'npcKo',
        { npc: 'stocker_1', source: player('a'), weapon: 'fists', respawnInSeconds: 30 },
        npcCtx,
      ),
    ).toEqual({ kind: 'ko', text: 'You knocked out the stocker' });
    expect(
      npcFeedLine(
        'npcKo',
        { npc: 'stocker_1', source: player('b'), weapon: 'fists', respawnInSeconds: 30 },
        npcCtx,
      ),
    ).toBeNull();
  });

  it('announces a new Wanted status, not a refresh', () => {
    const wanted = (player: string, refreshed: boolean) => ({
      player,
      reason: 'npc_damage',
      refreshed,
      seconds: 20,
    });
    expect(npcFeedLine('wanted', wanted('a', false), npcCtx)).toEqual({
      kind: 'wanted',
      text: 'You are WANTED! Security is after you',
    });
    expect(npcFeedLine('wanted', wanted('b', false), npcCtx)?.text).toBe('Mikko is wanted');
    expect(npcFeedLine('wanted', wanted('a', true), npcCtx)).toBeNull();
    expect(npcFeedLine('wantedEnded', { player: 'a' }, npcCtx)).toBeNull();
    expect(npcFeedLine('wanted', null, npcCtx)).toBeNull();
  });
});
