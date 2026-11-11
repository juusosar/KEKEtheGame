import { ItemEventMessage, getItemCatalogue, getWeaponCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { IGNORED_ITEM_MESSAGES } from '../net/session';
import {
  FEED_MESSAGES,
  combatFeedLine,
  feedLine,
  npcFeedLine,
  raceFeedLine,
  teamMoveLine,
  type FeedContext,
} from './feed';

const names: Record<string, string> = { a: 'Juuso', b: 'Mikko' };
const ctx: FeedContext = { catalogue: getItemCatalogue('kespro'), nameOf: (id) => names[id] ?? id };
const voi = { id: 4, itemId: 'coffee_juhla_mokka', rarity: 'normal', x: 0, y: 0 };
const mopo = { id: 5, itemId: 'kurkkumopo', rarity: 'joke', x: 0, y: 0 };

describe('feedLine', () => {
  it('announces a stolen target', () => {
    expect(
      feedLine('pickup', { player: 'a', item: voi, kind: 'other_target', targetOwner: 'b' }, ctx),
    ).toMatchObject({
      kind: 'steal',
      text: 'Juuso stole Paulig Juhla Mokka 500 g from Mikko',
    });
  });

  it('announces a joke item haul in capitals', () => {
    expect(
      feedLine('pickup', { player: 'b', item: mopo, kind: 'own_target', targetOwner: null }, ctx),
    ).toMatchObject({
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
    expect(feedLine('drop', { player: 'a', item: voi, reason: 'slip' }, ctx)).toMatchObject({
      kind: 'slip',
      text: 'Juuso slipped on a banana peel and dropped Paulig Juhla Mokka 500 g',
    });
    expect(feedLine('drop', { player: 'a', item: voi, reason: 'drop' }, ctx)).toBeNull();
  });

  it('announces a forklift run-over drop (M5-5)', () => {
    expect(feedLine('drop', { player: 'b', item: voi, reason: 'forklift' }, ctx)).toMatchObject({
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
    ).toMatchObject({ kind: 'ko', text: 'c knocked out Mikko with Frozen salmon' });
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
    ).toMatchObject({ kind: 'ko', text: 'You knocked out the stocker' });
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
    expect(npcFeedLine('wanted', wanted('a', false), npcCtx)).toMatchObject({
      kind: 'wanted',
      text: 'You are WANTED! Security is after you',
    });
    expect(npcFeedLine('wanted', wanted('b', false), npcCtx)?.text).toBe('Mikko is wanted');
    expect(npcFeedLine('wanted', wanted('a', true), npcCtx)).toBeNull();
    expect(npcFeedLine('wantedEnded', { player: 'a' }, npcCtx)).toBeNull();
    expect(npcFeedLine('wanted', null, npcCtx)).toBeNull();
  });

  it('only announces other players turning Wanted near us (playtest 1 problem 8)', () => {
    const wanted = (player: string) => ({ player, reason: 'npc_damage', refreshed: false, seconds: 20 });
    const near = { ...npcCtx, near: (id: string) => id === 'b' };
    expect(npcFeedLine('wanted', wanted('b'), near)?.text).toBe('Mikko is wanted');
    expect(npcFeedLine('wanted', wanted('c'), near)).toBeNull();
    // Our own Wanted line always shows, and is ours.
    expect(npcFeedLine('wanted', wanted('a'), { ...npcCtx, near: () => false })).toMatchObject({
      mine: true,
    });
  });
});

describe('feed lines about us (playtest 1 problem 8)', () => {
  it('marks our own hits, KOs and deposits as ours, and other players’ as not', () => {
    const weapons = getWeaponCatalogue();
    const combat = { weapons, me: 'a', nameOf: (id: string) => id.toUpperCase() };
    const ko = (player: string, by: string) => ({
      player,
      source: { kind: 'player', id: by },
      weapon: 'fists',
    });
    expect(combatFeedLine('ko', ko('a', 'b'), combat)?.mine).toBe(true);
    expect(combatFeedLine('ko', ko('b', 'a'), combat)?.mine).toBe(true);
    expect(combatFeedLine('ko', ko('b', 'c'), combat)?.mine).toBe(false);
    const item = { id: 3, itemId: 'coffee_juhla_mokka', rarity: 'normal', x: 0, y: 0 };
    const deposit = (player: string) => ({ player, item, van: 0, points: 1, vanTotal: 1 });
    expect(feedLine('deposit', deposit('a'), { ...ctx, me: 'a' })?.mine).toBe(true);
    expect(feedLine('deposit', deposit('b'), { ...ctx, me: 'a' })?.mine).toBe(false);
  });

  it('registers every item event: the ones without a feed line are ignored on purpose (playtest 1 idea 12)', () => {
    const handled = new Set<string>([...FEED_MESSAGES, ...IGNORED_ITEM_MESSAGES]);
    expect(Object.values(ItemEventMessage).filter((type) => !handled.has(type))).toEqual([]);
  });
});

describe('race feed lines (M6-3)', () => {
  const box = { id: 8, itemId: 'order_box', rarity: 'normal', x: 0, y: 0 };
  const vans: Record<string, number> = { a: 0, b: 1 };
  const race: FeedContext = {
    ...ctx,
    race: {
      boxVan: (id) => (id === 8 ? 1 : undefined),
      vanOf: (id) => vans[id] ?? -1,
      vanName: (van) => (van === 1 ? 'Mikko' : 'Juuso'),
    },
  };

  it('announces a box snatched from another van', () => {
    expect(
      feedLine('pickup', { player: 'a', item: box, kind: 'box', targetOwner: null }, race),
    ).toMatchObject({
      kind: 'box',
      text: 'Juuso snatched Mikko’s order box!',
    });
  });

  it('tells us when our side’s box hits the floor, unless we put it down (playtest 1 problem 6)', () => {
    const ours: FeedContext = { ...race, me: 'b' };
    expect(feedLine('drop', { player: 'a', item: box, reason: 'ko' }, ours)).toMatchObject({
      kind: 'box',
      text: 'Your order box hit the floor! Follow the red arrow.',
    });
    expect(feedLine('drop', { player: 'b', item: box, reason: 'ko' }, ours)?.kind).toBe('box');
    expect(feedLine('drop', { player: 'b', item: box, reason: 'drop' }, ours)).toBeNull();
    // Someone else's box: not our news.
    expect(feedLine('drop', { player: 'b', item: box, reason: 'ko' }, { ...race, me: 'a' })).toBeNull();
  });

  it('stays quiet when a player picks their own box back up, or without race names', () => {
    expect(feedLine('pickup', { player: 'b', item: box, kind: 'box', targetOwner: null }, race)).toBeNull();
    expect(feedLine('pickup', { player: 'a', item: box, kind: 'box', targetOwner: null }, ctx)).toBeNull();
  });

  it('names the box in slip lines', () => {
    expect(feedLine('drop', { player: 'a', item: box, reason: 'slip' }, race)?.text).toBe(
      'Juuso slipped on a banana peel and dropped Order box',
    );
  });

  const rctx = { me: 'a', nameOf: (id: string) => names[id] ?? id, vanName: () => 'Juuso' };

  it('announces packing, ours in its own words', () => {
    const packed = { player: 'b', van: 1, box, points: 7 };
    expect(raceFeedLine('boxPacked', packed, rctx)).toMatchObject({
      kind: 'packed',
      text: 'Mikko packed an order box (7 items)',
    });
    expect(raceFeedLine('boxPacked', { ...packed, player: 'a' }, rctx)?.text).toBe(
      'Your order box is packed: take it to the office!',
    );
  });

  it('announces deliveries, stolen ones with the victim', () => {
    const delivery = { player: 'b', van: 1, box, packedVan: 1, points: 6, stolen: false };
    expect(raceFeedLine('delivery', delivery, rctx)).toMatchObject({
      kind: 'delivery',
      text: 'Mikko delivered the order box!',
    });
    expect(raceFeedLine('delivery', { ...delivery, packedVan: 0, stolen: true }, rctx)?.text).toBe(
      'Mikko delivered Juuso’s stolen order box!',
    );
    expect(raceFeedLine('delivery', { ...delivery, player: 'a' }, rctx)?.text).toBe(
      'You delivered the order box!',
    );
  });

  it('ignores other types and malformed messages', () => {
    expect(raceFeedLine('pickup', { player: 'a' }, rctx)).toBeNull();
    expect(raceFeedLine('delivery', null, rctx)).toBeNull();
  });
});

describe('team move line (M6 review F7)', () => {
  it('tells us when a rebalance moved us to the other team', () => {
    expect(teamMoveLine(1, 2)).toMatchObject({
      kind: 'team',
      text: 'Teams were rebalanced: you moved to Team 2',
    });
    expect(teamMoveLine(2, 1)?.text).toBe('Teams were rebalanced: you moved to Team 1');
  });

  it('stays quiet on the first look, without a change, and without teams', () => {
    expect(teamMoveLine(undefined, 2)).toBeNull();
    expect(teamMoveLine(1, 1)).toBeNull();
    expect(teamMoveLine(0, 1)).toBeNull();
    expect(teamMoveLine(1, 0)).toBeNull();
  });
});
