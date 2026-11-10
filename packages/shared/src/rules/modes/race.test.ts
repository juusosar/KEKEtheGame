import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { getItemCatalogue } from '../../items';
import { phaseSeconds } from '../../lobby/phases';
import { createRng } from '../../rng';
import {
  addCarryPlayer,
  assignTargets,
  createItemWorld,
  deposit,
  despawnLooseItems,
  drop,
  findCarryPlayer,
  findItem,
  isCarrying,
  moveLyingItems,
  pickup,
  removeCarryPlayer,
  vanPointsOf,
  type ItemWorld,
  type WorldItem,
} from '../carry';
import type { TargetMap } from '../targets';
import {
  ORDER_BOX_ITEM_ID,
  carriedBox,
  deliver,
  isCarryingBox,
  isOrderBox,
  isRaceRoundOver,
  itemsControlled,
  orderBoxes,
  quotaProgress,
  raceDeposit,
  rankRaceRound,
  type RaceConfig,
  type RaceDelivery,
  type RaceResult,
} from './race';
import { teamSideId, type TimedPlayerScore } from './timed';

const config = loadConfig();
/** A small quota keeps the scenarios short; one test checks the default 6. */
const cfg: RaceConfig = { raceQuota: 3, jokeItemValue: config.jokeItemValue };
const at = { x: 40, y: 50 };

/** Hands `playerId` a freshly made carried item (stands in for a pickup of their target). */
function give(world: ItemWorld, playerId: string, rarity: 'normal' | 'joke' = 'normal'): ItemWorld {
  const item: WorldItem = {
    id: world.nextItemId,
    itemId: rarity === 'joke' ? 'gnome' : 'flour',
    rarity,
    state: 'carried',
    x: 0,
    y: 0,
    owner: null,
    carrier: playerId,
    looseSince: null,
  };
  return {
    ...world,
    nextItemId: world.nextItemId + 1,
    items: [...world.items, item],
    players: world.players.map((p) => (p.id === playerId ? { ...p, carrying: item.id } : p)),
  };
}

function ok(result: RaceResult | { world: ItemWorld; rejected?: string }): ItemWorld {
  expect(result.rejected).toBeUndefined();
  return result.world;
}

/** Deposits `n` normal items for `playerId` through the race rules. */
function bank(world: ItemWorld, playerId: string, n: number): ItemWorld {
  let w = world;
  for (let i = 0; i < n; i++) w = ok(raceDeposit(give(w, playerId), playerId, at, cfg));
  return w;
}

/** Players a (van 1), b (van 2), c (van 3), free-for-all. */
function ffa(): ItemWorld {
  let w = createItemWorld();
  w = addCarryPlayer(w, 'a', 1);
  w = addCarryPlayer(w, 'b', 2);
  w = addCarryPlayer(w, 'c', 3);
  return w;
}

const score = (id: string, itemPoints = 0, team = 0): TimedPlayerScore => ({ id, itemPoints, team });

function deliveryOf(result: RaceResult): RaceDelivery {
  expect(result.delivery).toBeDefined();
  return result.delivery as RaceDelivery;
}

describe('race config', () => {
  it('uses a quota of 6 and a 240 s round cap by default', () => {
    expect(config.raceQuota).toBe(6);
    expect(config.raceRoundSeconds).toBe(240);
    expect(phaseSeconds('playing', 'race', config)).toBe(240);
  });

  it('never clashes with a catalogue item id', () => {
    expect(getItemCatalogue('kespro').items.some((i) => i.id === ORDER_BOX_ITEM_ID)).toBe(false);
  });
});

describe('quota and box packing', () => {
  it('deposits normally below the quota', () => {
    const result = raceDeposit(give(ffa(), 'a'), 'a', at, cfg);
    expect(result.events.map((e) => e.type)).toEqual(['deposit']);
    expect(vanPointsOf(result.world, 1)).toBe(1);
    expect(quotaProgress(result.world, 1, cfg)).toEqual({ points: 1, quota: 3 });
    expect(orderBoxes(result.world)).toEqual([]);
  });

  it('packs the van into a box the depositor carries when the quota is reached', () => {
    const before = bank(ffa(), 'a', 2);
    const result = raceDeposit(give(before, 'a'), 'a', at, cfg);
    expect(result.events.map((e) => e.type)).toEqual(['deposit', 'boxPacked']);
    const w = result.world;
    const box = carriedBox(w, 'a');
    expect(box).toMatchObject({
      itemId: ORDER_BOX_ITEM_ID,
      state: 'carried',
      carrier: 'a',
      x: at.x,
      y: at.y,
      box: { van: 1, points: 3, packedBy: 'a' },
    });
    expect(vanPointsOf(w, 1)).toBe(0);
    expect(isCarrying(w, 'a')).toBe(true);
    expect(isCarryingBox(w, 'a')).toBe(true);
    // The deposit still counts as the player's own (session tie-break).
    expect(findCarryPlayer(w, 'a')?.deposited).toBe(3);
    const packed = result.events[1];
    expect(packed).toMatchObject({ type: 'boxPacked', player: 'a', van: 1, box: { id: box?.id } });
  });

  it('reaches the default quota of 6 on the sixth item', () => {
    const six: RaceConfig = { raceQuota: config.raceQuota, jokeItemValue: config.jokeItemValue };
    let w = ffa();
    for (let i = 0; i < 5; i++) w = ok(raceDeposit(give(w, 'a'), 'a', at, six));
    expect(orderBoxes(w)).toEqual([]);
    w = ok(raceDeposit(give(w, 'a'), 'a', at, six));
    expect(carriedBox(w, 'a')?.box.points).toBe(6);
  });

  it('counts joke items as item points, so a joke item can overshoot the quota', () => {
    let w = bank(ffa(), 'a', 2);
    w = ok(raceDeposit(give(w, 'a', 'joke'), 'a', at, cfg));
    expect(carriedBox(w, 'a')?.box.points).toBe(4);
    expect(vanPointsOf(w, 1)).toBe(0);
  });

  it('keeps vans separate: another van does not count towards yours', () => {
    let w = bank(ffa(), 'a', 2);
    w = bank(w, 'b', 2);
    expect(orderBoxes(w)).toEqual([]);
    expect(vanPointsOf(w, 1)).toBe(2);
    expect(vanPointsOf(w, 2)).toBe(2);
  });

  it('packs again when the van reaches the quota a second time', () => {
    let w = bank(ffa(), 'a', 3);
    w = ok(drop(w, 'a', { x: 1, y: 1 }, 10, 'ko'));
    w = bank(w, 'a', 3);
    expect(orderBoxes(w).map((b) => [b.state, b.box.van, b.box.points])).toEqual([
      ['loose', 1, 3],
      ['carried', 1, 3],
    ]);
  });

  it('refuses a deposit without an item and changes nothing', () => {
    const w = ffa();
    const result = raceDeposit(w, 'a', at, cfg);
    expect(result.rejected).toBe('not_carrying');
    expect(result.world).toBe(w);
  });
});

describe('carrying a box (normal carry rules)', () => {
  const packed = (): ItemWorld => bank(ffa(), 'a', 3);

  it('cannot be deposited into a van, by the race or the plain deposit', () => {
    const w = packed();
    expect(raceDeposit(w, 'a', at, cfg).rejected).toBe('box_not_depositable');
    expect(deposit(w, 'a', cfg).rejected).toBe('box_not_depositable');
    expect(deposit(w, 'a', cfg).world).toBe(w);
  });

  it('blocks picking up items while carrying the box', () => {
    let w = packed();
    w = give(w, 'b');
    w = ok(drop(w, 'b', { x: 5, y: 5 }, 1, 'drop'));
    const loose = w.items.find((i) => i.state === 'loose' && !isOrderBox(i));
    expect(pickup(w, 'a', loose?.id ?? -1).rejected).toBe('already_carrying');
  });

  it('gets no new target while carrying the box', () => {
    const map: TargetMap = {
      tileSize: 32,
      vanSlots: [{ x: 0, y: 0 }],
      itemSpawns: Array.from({ length: 6 }, (_, i) => ({ x: (12 + i * 2) * 32, y: 0, zone: 'dry_goods' })),
    };
    const result = assignTargets(packed(), {
      catalogue: [{ id: 'flour', zone: 'dry_goods', rarity: 'normal' }],
      map,
      rng: createRng(1),
      config: { ...config, jokeItemChance: 0 },
    });
    expect(findCarryPlayer(result.world, 'a')?.target).toBeNull();
    expect(findCarryPlayer(result.world, 'b')?.target).not.toBeNull();
  });

  it('drops on KO where the carrier fell and never despawns', () => {
    let w = packed();
    const id = carriedBox(w, 'a')?.id ?? -1;
    const dropped = drop(w, 'a', { x: 300, y: 400 }, 20, 'ko');
    expect(dropped.events).toMatchObject([{ type: 'drop', reason: 'ko', item: { id } }]);
    w = dropped.world;
    expect(findItem(w, id)).toMatchObject({ state: 'loose', x: 300, y: 400, carrier: null });
    expect(isCarrying(w, 'a')).toBe(false);
    expect(despawnLooseItems(w, 20 + config.looseItemDespawnSeconds * 10, config).events).toEqual([]);
    expect(findItem(w, id)).toBeDefined();
  });

  it('drops on a banana slip, a forklift and on leaving, like any item', () => {
    for (const reason of ['slip', 'forklift', 'disconnect'] as const) {
      const w = ok(drop(packed(), 'a', { x: 1, y: 2 }, 5, reason));
      expect(orderBoxes(w)[0]?.state).toBe('loose');
    }
    const left = ok(removeCarryPlayer(packed(), 'a', { x: 7, y: 8 }, 5));
    expect(orderBoxes(left)[0]).toMatchObject({ state: 'loose', x: 7, y: 8 });
  });

  it('is pushed by a pallet jack scatter when lying', () => {
    let w = ok(drop(packed(), 'a', { x: 1, y: 2 }, 5, 'drop'));
    const id = orderBoxes(w)[0]?.id ?? -1;
    w = ok(moveLyingItems(w, [{ id, x: 50, y: 60 }]));
    expect(findItem(w, id)).toMatchObject({ x: 50, y: 60 });
  });

  it('can be picked up by anyone (kind box), the packer keeps no claim', () => {
    let w = ok(drop(packed(), 'a', { x: 1, y: 2 }, 5, 'ko'));
    const id = orderBoxes(w)[0]?.id ?? -1;
    const stolen = pickup(w, 'b', id);
    expect(stolen.events).toMatchObject([{ type: 'pickup', player: 'b', kind: 'box', targetOwner: null }]);
    w = stolen.world;
    expect(carriedBox(w, 'b')?.box).toEqual({ van: 1, points: 3, packedBy: 'a' });
    // The thief cannot bank it in their van either.
    expect(raceDeposit(w, 'b', at, cfg).rejected).toBe('box_not_depositable');
  });
});

describe('delivery', () => {
  it('delivers your own box: the box leaves the world and the delivery is returned', () => {
    const w = bank(ffa(), 'a', 3);
    const box = carriedBox(w, 'a');
    const result = deliver(w, 'a', 95.5);
    expect(result.rejected).toBeUndefined();
    expect(result.events).toEqual([{ type: 'delivery', player: 'a', van: 1, box, stolen: false }]);
    expect(deliveryOf(result)).toEqual({ player: 'a', van: 1, box, at: 95.5 });
    expect(orderBoxes(result.world)).toEqual([]);
    expect(isCarrying(result.world, 'a')).toBe(false);
  });

  it('delivers a stolen box as the thief’s own', () => {
    let w = ok(drop(bank(ffa(), 'a', 3), 'a', { x: 1, y: 2 }, 5, 'ko'));
    w = ok(pickup(w, 'b', orderBoxes(w)[0]?.id ?? -1));
    const result = deliver(w, 'b', 120);
    expect(result.events).toMatchObject([{ type: 'delivery', player: 'b', van: 2, stolen: true }]);
    expect(deliveryOf(result)).toMatchObject({ player: 'b', van: 2, box: { box: { van: 1 } } });
  });

  it('refuses a player who carries nothing or a normal item', () => {
    const w = give(ffa(), 'a');
    expect(deliver(w, 'a', 1)).toEqual({ world: w, events: [], rejected: 'not_carrying_box' });
    expect(deliver(w, 'b', 1).rejected).toBe('not_carrying_box');
    expect(deliver(w, 'zz', 1).rejected).toBe('unknown_player');
  });

  it('ends the round on delivery or when the cap runs out', () => {
    const delivery = deliveryOf(deliver(bank(ffa(), 'a', 3), 'a', 10));
    expect(isRaceRoundOver(200, null)).toBe(false);
    expect(isRaceRoundOver(0.01, null)).toBe(false);
    expect(isRaceRoundOver(0, null)).toBe(true);
    expect(isRaceRoundOver(200, delivery)).toBe(true);
  });
});

describe('items you control', () => {
  it('counts the van plus a box its own side carries', () => {
    let w = bank(ffa(), 'a', 3); // packed: van 1 is back to 0, a carries the 3-point box
    expect(itemsControlled(w, 1)).toBe(3);
    w = bank(w, 'b', 2);
    expect(itemsControlled(w, 2)).toBe(2);
    expect(itemsControlled(w, 3)).toBe(0);
  });

  it('a lying box counts for nobody', () => {
    const w = ok(drop(bank(ffa(), 'a', 3), 'a', { x: 1, y: 1 }, 5, 'ko'));
    expect(itemsControlled(w, 1)).toBe(0);
  });

  it('a box held by an opponent counts for nobody (not the thief either)', () => {
    let w = ok(drop(bank(ffa(), 'a', 3), 'a', { x: 1, y: 1 }, 5, 'ko'));
    w = bank(w, 'b', 1);
    w = ok(pickup(w, 'b', orderBoxes(w)[0]?.id ?? -1));
    expect(itemsControlled(w, 1)).toBe(0);
    expect(itemsControlled(w, 2)).toBe(1);
  });

  it('a box carried by a teammate (same van) counts for the team', () => {
    let w = createItemWorld();
    w = addCarryPlayer(w, 'a', 1);
    w = addCarryPlayer(w, 'a2', 1);
    w = bank(w, 'a', 3);
    w = ok(drop(w, 'a', { x: 1, y: 1 }, 5, 'drop'));
    w = ok(pickup(w, 'a2', orderBoxes(w)[0]?.id ?? -1));
    w = bank(w, 'a', 1);
    expect(itemsControlled(w, 1)).toBe(4);
  });
});

describe('rankRaceRound', () => {
  it('time cap: ranks everyone by items they control, ties share the higher place', () => {
    let w = bank(ffa(), 'a', 3); // a carries a 3-point box
    w = bank(w, 'b', 2);
    w = bank(w, 'c', 2);
    const result = rankRaceRound(w, [score('a', 3), score('b', 2), score('c', 2)], false, null);
    expect(result.winner).toBeNull();
    expect(result.standings).toEqual([
      { id: 'a', itemPoints: 3, place: 1, delivered: false },
      { id: 'b', itemPoints: 2, place: 2, delivered: false },
      { id: 'c', itemPoints: 2, place: 2, delivered: false },
    ]);
    expect(result.players.map((p) => [p.id, p.place, p.itemPoints])).toEqual([
      ['a', 1, 3],
      ['b', 2, 2],
      ['c', 2, 2],
    ]);
  });

  it('own delivery: the deliverer is 1st, the rest ranked by items they control at that moment', () => {
    let w = bank(ffa(), 'b', 2);
    w = bank(w, 'c', 1);
    w = bank(w, 'a', 3);
    const delivered = deliver(w, 'a', 100);
    const result = rankRaceRound(
      delivered.world,
      [score('a', 3), score('b', 2), score('c', 1)],
      false,
      deliveryOf(delivered),
    );
    expect(result.winner).toBe('a');
    expect(result.standings).toEqual([
      { id: 'a', itemPoints: 0, place: 1, delivered: true },
      { id: 'b', itemPoints: 2, place: 2, delivered: false },
      { id: 'c', itemPoints: 1, place: 3, delivered: false },
    ]);
  });

  it('stolen delivery: the thief wins even with fewer items, the robbed van loses the box', () => {
    let w = bank(ffa(), 'a', 3);
    w = ok(drop(w, 'a', { x: 1, y: 1 }, 5, 'ko'));
    w = bank(w, 'a', 1);
    w = bank(w, 'c', 2);
    w = ok(pickup(w, 'b', orderBoxes(w)[0]?.id ?? -1));
    const delivered = deliver(w, 'b', 150);
    const result = rankRaceRound(
      delivered.world,
      [score('a', 4), score('b', 0), score('c', 2)],
      false,
      deliveryOf(delivered),
    );
    expect(result.standings.map((s) => [s.id, s.place, s.itemPoints, s.delivered])).toEqual([
      ['b', 1, 0, true],
      ['c', 2, 2, false],
      ['a', 3, 1, false],
    ]);
    // Per-player item points stay their own deposits (session tie-break).
    expect(result.players.find((p) => p.id === 'a')?.itemPoints).toBe(4);
  });

  it('ties behind the winner share the higher place (1, 2, 2)', () => {
    let w = bank(ffa(), 'b', 1);
    w = bank(w, 'c', 1);
    w = bank(w, 'a', 3);
    const delivered = deliver(w, 'a', 50);
    const result = rankRaceRound(
      delivered.world,
      [score('c'), score('b'), score('a')],
      false,
      deliveryOf(delivered),
    );
    expect(result.players.map((p) => [p.id, p.place])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
    ]);
  });

  it('does not depend on input order', () => {
    let w = bank(ffa(), 'a', 2);
    w = bank(w, 'b', 1);
    const one = rankRaceRound(w, [score('a'), score('b'), score('c')], false, null);
    const two = rankRaceRound(w, [score('c'), score('b'), score('a')], false, null);
    expect(two).toEqual(one);
  });

  it('a deliverer who already left: nobody is placed first by delivery', () => {
    let w = bank(ffa(), 'b', 1);
    w = bank(w, 'a', 3);
    const delivery = deliveryOf(deliver(w, 'a', 30));
    const result = rankRaceRound(w, [score('b'), score('c')], false, delivery);
    expect(result.winner).toBeNull();
    expect(result.standings.map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('a player missing from the world controls nothing', () => {
    const result = rankRaceRound(bank(ffa(), 'a', 1), [score('a'), score('ghost')], false, null);
    expect(result.standings.map((s) => [s.id, s.itemPoints, s.place])).toEqual([
      ['a', 1, 1],
      ['ghost', 0, 2],
    ]);
  });

  it('throws on duplicate player ids', () => {
    expect(() => rankRaceRound(ffa(), [score('a'), score('a')], false, null)).toThrow(/duplicate/);
  });

  describe('with teams (shared van, quota and box)', () => {
    /** Team 1 = a1, a2 on van 1; team 2 = b1, b2 on van 2; solo (team 0) on van 3. */
    function teamWorld(): ItemWorld {
      let w = createItemWorld();
      for (const [id, van] of [
        ['a1', 1],
        ['a2', 1],
        ['b1', 2],
        ['b2', 2],
        ['solo', 3],
      ] as const)
        w = addCarryPlayer(w, id, van);
      return w;
    }
    const roster = (pts: Record<string, number> = {}): TimedPlayerScore[] => [
      score('a1', pts.a1 ?? 0, 1),
      score('a2', pts.a2 ?? 0, 1),
      score('b1', pts.b1 ?? 0, 2),
      score('b2', pts.b2 ?? 0, 2),
      score('solo', pts.solo ?? 0, 0),
    ];

    it('teammates fill one quota together and either can carry the box', () => {
      let w = bank(teamWorld(), 'a1', 2);
      w = bank(w, 'a2', 1);
      expect(carriedBox(w, 'a2')?.box).toEqual({ van: 1, points: 3, packedBy: 'a2' });
      w = ok(drop(w, 'a2', { x: 1, y: 1 }, 5, 'drop'));
      w = ok(pickup(w, 'a1', orderBoxes(w)[0]?.id ?? -1));
      expect(deliver(w, 'a1', 9).events).toMatchObject([{ type: 'delivery', stolen: false }]);
    });

    it('a teammate’s delivery wins for the whole team; teams rank by their shared van', () => {
      let w = bank(teamWorld(), 'b1', 2);
      w = bank(w, 'solo', 1);
      w = bank(w, 'a1', 3);
      const delivered = deliver(w, 'a1', 77);
      const result = rankRaceRound(
        delivered.world,
        roster({ a1: 3, b1: 2, solo: 1 }),
        true,
        deliveryOf(delivered),
      );
      expect(result.winner).toBe(teamSideId(1));
      expect(result.standings.map((s) => [s.id, s.place, s.itemPoints])).toEqual([
        [teamSideId(1), 1, 0],
        [teamSideId(2), 2, 2],
        ['solo', 3, 1],
      ]);
      expect(result.players.map((p) => [p.id, p.place, p.team])).toEqual([
        ['a1', 1, 1],
        ['a2', 1, 1],
        ['b1', 2, 2],
        ['b2', 2, 2],
        ['solo', 3, 0],
      ]);
    });

    it('a team that steals the other team’s box wins by delivering it', () => {
      let w = bank(teamWorld(), 'a1', 3);
      w = ok(drop(w, 'a1', { x: 1, y: 1 }, 5, 'ko'));
      w = ok(pickup(w, 'b2', orderBoxes(w)[0]?.id ?? -1));
      expect(itemsControlled(w, 1)).toBe(0);
      const delivered = deliver(w, 'b2', 60);
      expect(delivered.events).toMatchObject([{ stolen: true }]);
      const result = rankRaceRound(delivered.world, roster({ a1: 3 }), true, deliveryOf(delivered));
      expect(result.winner).toBe(teamSideId(2));
    });

    it('time cap: the team carrying its own box leads', () => {
      let w = bank(teamWorld(), 'a1', 3);
      w = bank(w, 'b1', 2);
      const result = rankRaceRound(w, roster(), true, null);
      expect(result.standings.map((s) => [s.id, s.itemPoints, s.place])).toEqual([
        [teamSideId(1), 3, 1],
        [teamSideId(2), 2, 2],
        ['solo', 0, 3],
      ]);
    });

    it('counts a team van once even when every member names it', () => {
      const w = bank(teamWorld(), 'b1', 2);
      const result = rankRaceRound(w, roster(), true, null);
      expect(result.standings.find((s) => s.id === teamSideId(2))?.itemPoints).toBe(2);
    });
  });
});
