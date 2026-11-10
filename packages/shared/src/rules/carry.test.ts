import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createRng } from '../rng';
import { carryMultiplier } from './movement';
import {
  addCarryPlayer,
  assignTargets,
  createItemWorld,
  deposit,
  despawnLooseItems,
  drop,
  findItem,
  findCarryPlayer,
  isCarrying,
  pickup,
  removeCarryPlayer,
  setPlayerVan,
  vanPointsOf,
  type AssignTargetsContext,
  type CarryResult,
  type ItemWorld,
} from './carry';
import { ANY_ZONE } from '../items/catalogue';
import { type TargetAssigner, type TargetItemDef, type TargetMap } from './targets';

const config = loadConfig();
const T = 32;

const map: TargetMap = {
  tileSize: T,
  vanSlots: [
    { x: 0, y: 0 },
    { x: 0, y: 2 * T },
  ],
  itemSpawns: Array.from({ length: 10 }, (_, i) => ({ x: (10 + i * 2) * T, y: 0, zone: 'dry_goods' })),
};

const flour: TargetItemDef = { id: 'flour', zone: 'dry_goods', rarity: 'normal' };
const gnome: TargetItemDef = { id: 'gnome', zone: ANY_ZONE, rarity: 'joke' };
const catalogue = [flour, gnome];

function ctx(seed = 1, overrides: Partial<AssignTargetsContext> = {}): AssignTargetsContext {
  return { catalogue, map, rng: createRng(seed), config: { ...config, jokeItemChance: 0 }, ...overrides };
}

/** A world with players a (van 1) and b (van 2), each with a fresh target. */
function setup(): ItemWorld {
  let w = createItemWorld();
  w = addCarryPlayer(w, 'a', 1);
  w = addCarryPlayer(w, 'b', 2);
  return assignTargets(w, ctx()).world;
}

function ok(result: CarryResult): ItemWorld {
  expect(result.rejected).toBeUndefined();
  return result.world;
}

const targetOf = (w: ItemWorld, id: string): number => {
  const t = findCarryPlayer(w, id)?.target;
  if (t == null) throw new Error(`${id} has no target`);
  return t;
};

describe('target assignment (§3.1)', () => {
  it('gives every player exactly one target while not carrying', () => {
    const w = setup();
    for (const id of ['a', 'b']) {
      const t = findItem(w, targetOf(w, id));
      expect(t).toMatchObject({ state: 'target', owner: id, carrier: null });
    }
    expect(w.items).toHaveLength(2);
    // Calling again does not hand out a second target.
    const again = assignTargets(w, ctx(2));
    expect(again.events).toEqual([]);
    expect(again.world.items).toHaveLength(2);
  });

  it('emits a targetAssigned event per new target, in join order', () => {
    const w = addCarryPlayer(addCarryPlayer(createItemWorld(), 'a', 1), 'b', 2);
    const r = assignTargets(w, ctx());
    expect(r.events.map((e) => (e.type === 'targetAssigned' ? e.player : ''))).toEqual(['a', 'b']);
  });

  it('never puts two targets on the same spawn', () => {
    let w = createItemWorld();
    for (let i = 0; i < 10; i++) w = addCarryPlayer(w, `p${i}`, i + 1);
    w = assignTargets(w, ctx(7)).world;
    const spots = new Set(w.items.map((i) => `${i.x},${i.y}`));
    expect(spots.size).toBe(10);
  });

  it('leaves a player without a target while no spawn is free, and fills it later', () => {
    let w = createItemWorld();
    for (let i = 0; i < 11; i++) w = addCarryPlayer(w, `p${i}`, i + 1);
    w = assignTargets(w, ctx()).world;
    expect(findCarryPlayer(w, 'p10')?.target).toBeNull();
    // p0 deposits their own target, freeing a spawn.
    w = ok(pickup(w, 'p0', targetOf(w, 'p0')));
    w = assignTargets(w, ctx()).world;
    expect(findCarryPlayer(w, 'p10')?.target).not.toBeNull();
  });

  it('uses the given TargetAssigner so the model can be swapped', () => {
    const fixed: TargetAssigner = {
      id: 'fixed',
      place: () => ({ item: gnome, x: 999, y: 999, zone: 'dry_goods' }),
    };
    const w = assignTargets(addCarryPlayer(createItemWorld(), 'a', 1), ctx(1, { assigner: fixed })).world;
    expect(w.items[0]).toMatchObject({ itemId: 'gnome', rarity: 'joke', x: 999, y: 999 });
  });

  it('is deterministic for a seed', () => {
    expect(setup()).toEqual(setup());
  });
});

describe('pickup (§3.1)', () => {
  it('picking up your own target leaves you with no target while carrying', () => {
    let w = setup();
    const own = targetOf(w, 'a');
    const r = pickup(w, 'a', own);
    w = ok(r);
    expect(findCarryPlayer(w, 'a')).toMatchObject({ carrying: own, target: null });
    expect(findItem(w, own)).toMatchObject({ state: 'carried', carrier: 'a', owner: null });
    expect(r.events).toEqual([
      expect.objectContaining({ type: 'pickup', kind: 'own_target', targetOwner: null }),
    ]);
    // No new target while carrying.
    expect(assignTargets(w, ctx(3)).events).toEqual([]);
  });

  it("picking up someone else's target gives them a new one and keeps yours in place", () => {
    let w = setup();
    const mine = targetOf(w, 'a');
    const theirs = targetOf(w, 'b');
    const r = pickup(w, 'a', theirs);
    w = ok(r);
    expect(r.events[0]).toMatchObject({ type: 'pickup', kind: 'other_target', targetOwner: 'b' });
    expect(findCarryPlayer(w, 'a')).toMatchObject({ carrying: theirs, target: mine });
    expect(findItem(w, mine)).toMatchObject({ state: 'target', owner: 'a' });
    expect(findCarryPlayer(w, 'b')?.target).toBeNull();
    const after = assignTargets(w, ctx(3));
    expect(after.events).toEqual([expect.objectContaining({ type: 'targetAssigned', player: 'b' })]);
    expect(findCarryPlayer(after.world, 'b')?.target).not.toBe(theirs);
  });

  it('anyone can pick up a loose item', () => {
    let w = setup();
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    const item = findCarryPlayer(w, 'a')?.carrying as number;
    w = ok(drop(w, 'a', { x: 5, y: 5 }, 10, 'drop'));
    const r = pickup(w, 'b', item);
    w = ok(r);
    expect(r.events[0]).toMatchObject({ kind: 'loose', targetOwner: null });
    expect(findItem(w, item)).toMatchObject({ state: 'carried', carrier: 'b', looseSince: null });
  });

  it('carries at most one item', () => {
    let w = setup();
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    const r = pickup(w, 'a', targetOf(w, 'b'));
    expect(r.rejected).toBe('already_carrying');
    expect(r.world).toBe(w);
  });

  it('cannot take an item someone is carrying (steal by KO instead)', () => {
    let w = setup();
    const own = targetOf(w, 'a');
    w = ok(pickup(w, 'a', own));
    expect(pickup(w, 'b', own).rejected).toBe('item_carried');
  });

  it('rejects unknown players and items', () => {
    const w = setup();
    expect(pickup(w, 'zz', 1).rejected).toBe('unknown_player');
    expect(pickup(w, 'a', 999).rejected).toBe('unknown_item');
  });
});

describe('carry speed (§3.2)', () => {
  it('a carrier moves at carrySpeedMultiplier (0.85)', () => {
    let w = setup();
    expect(carryMultiplier(config, isCarrying(w, 'a'))).toBe(1);
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    expect(carryMultiplier(config, isCarrying(w, 'a'))).toBe(0.85);
  });
});

describe('drop (§3.2)', () => {
  it('dropping on purpose leaves a loose item and the player gets a new target', () => {
    let w = setup();
    const own = targetOf(w, 'a');
    w = ok(pickup(w, 'a', own));
    const r = drop(w, 'a', { x: 100, y: 50 }, 12, 'drop');
    w = ok(r);
    expect(findItem(w, own)).toMatchObject({
      state: 'loose',
      x: 100,
      y: 50,
      owner: null,
      carrier: null,
      looseSince: 12,
    });
    expect(findCarryPlayer(w, 'a')?.carrying).toBeNull();
    expect(r.events[0]).toMatchObject({ type: 'drop', reason: 'drop' });
    const after = assignTargets(w, ctx(5));
    expect(findCarryPlayer(after.world, 'a')?.target).not.toBeNull();
  });

  it('on KO the carried item drops at the KO location', () => {
    let w = setup();
    const theirs = targetOf(w, 'b');
    w = ok(pickup(w, 'a', theirs));
    const r = drop(w, 'a', { x: 300, y: 40 }, 20, 'ko');
    w = ok(r);
    expect(findItem(w, theirs)).toMatchObject({ state: 'loose', x: 300, y: 40 });
    expect(r.events[0]).toMatchObject({ reason: 'ko' });
    // The KO'd player's own target is untouched.
    expect(findItem(w, targetOf(w, 'a'))).toMatchObject({ state: 'target', owner: 'a' });
  });

  it('a stolen target does not go back to its old owner when dropped', () => {
    let w = setup();
    const theirs = targetOf(w, 'b');
    w = ok(pickup(w, 'a', theirs));
    w = assignTargets(w, ctx(3)).world;
    w = ok(drop(w, 'a', { x: 1, y: 1 }, 0, 'ko'));
    expect(findItem(w, theirs)?.owner).toBeNull();
    expect(findCarryPlayer(w, 'b')?.target).not.toBe(theirs);
  });

  it('rejects a drop with nothing carried', () => {
    expect(drop(setup(), 'a', { x: 0, y: 0 }, 0, 'drop').rejected).toBe('not_carrying');
  });
});

describe('loose item despawn (§3.1)', () => {
  it('despawns loose items after looseItemDespawnSeconds (30 s)', () => {
    let w = setup();
    const own = targetOf(w, 'a');
    w = ok(pickup(w, 'a', own));
    w = ok(drop(w, 'a', { x: 0, y: 0 }, 100, 'drop'));
    expect(despawnLooseItems(w, 129.9, config).events).toEqual([]);
    const r = despawnLooseItems(w, 130, config);
    expect(r.events).toEqual([expect.objectContaining({ type: 'despawn' })]);
    expect(findItem(r.world, own)).toBeUndefined();
  });

  it('never despawns targets or carried items', () => {
    let w = setup();
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    expect(despawnLooseItems(w, 1e6, config).world.items).toHaveLength(w.items.length);
  });

  it('a loose item picked up before the timer is safe', () => {
    let w = setup();
    const own = targetOf(w, 'a');
    w = ok(pickup(w, 'a', own));
    w = ok(drop(w, 'a', { x: 0, y: 0 }, 0, 'drop'));
    w = ok(pickup(w, 'b', own));
    expect(findItem(despawnLooseItems(w, 1000, config).world, own)).toBeDefined();
  });
});

describe('deposit scoring (§3 step 5, §3.2)', () => {
  it('banks +1 for a normal item in the depositor’s van and removes the item', () => {
    let w = setup();
    const own = targetOf(w, 'a');
    w = ok(pickup(w, 'a', own));
    const r = deposit(w, 'a', config);
    w = ok(r);
    expect(r.events[0]).toMatchObject({ type: 'deposit', player: 'a', van: 1, points: 1, vanTotal: 1 });
    expect(vanPointsOf(w, 1)).toBe(1);
    expect(findCarryPlayer(w, 'a')).toMatchObject({ carrying: null, deposited: 1 });
    expect(findItem(w, own)).toBeUndefined();
    expect(findCarryPlayer(assignTargets(w, ctx(4)).world, 'a')?.target).not.toBeNull();
  });

  it('banks +2 for a joke item', () => {
    const jokeCtx = ctx(1, { config: { ...config, jokeItemChance: 1 } });
    let w = assignTargets(addCarryPlayer(createItemWorld(), 'a', 1), jokeCtx).world;
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    expect(deposit(w, 'a', config).events[0]).toMatchObject({ points: 2, vanTotal: 2 });
  });

  it('whoever deposits scores, even with a stolen target', () => {
    let w = setup();
    w = ok(pickup(w, 'a', targetOf(w, 'b')));
    w = ok(deposit(w, 'a', config));
    expect(vanPointsOf(w, 1)).toBe(1);
    expect(vanPointsOf(w, 2)).toBe(0);
  });

  it('deposits are banked: dropping or KO later takes nothing from the van', () => {
    let w = setup();
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    w = ok(deposit(w, 'a', config));
    w = assignTargets(w, ctx(9)).world;
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    w = ok(drop(w, 'a', { x: 0, y: 0 }, 0, 'ko'));
    expect(vanPointsOf(w, 1)).toBe(1);
  });

  it('teammates sharing a van add to one total', () => {
    let w = setup();
    w = setPlayerVan(w, 'b', 1);
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    w = ok(deposit(w, 'a', config));
    w = ok(pickup(w, 'b', targetOf(w, 'b')));
    const r = deposit(w, 'b', config);
    expect(r.events[0]).toMatchObject({ van: 1, vanTotal: 2 });
    expect(findCarryPlayer(r.world, 'b')?.deposited).toBe(1);
  });

  it('rejects a deposit with nothing carried', () => {
    expect(deposit(setup(), 'a', config).rejected).toBe('not_carrying');
  });
});

describe('players leaving', () => {
  it('drops their carried item, despawns their target and keeps van points', () => {
    let w = setup();
    const theirs = targetOf(w, 'b');
    w = ok(pickup(w, 'a', targetOf(w, 'a')));
    w = ok(deposit(w, 'a', config));
    w = assignTargets(w, ctx(2)).world;
    const ownNow = targetOf(w, 'a');
    w = ok(pickup(w, 'a', theirs));
    const r = removeCarryPlayer(w, 'a', { x: 7, y: 7 }, 3);
    w = ok(r);
    expect(r.events.map((e) => e.type)).toEqual(['drop', 'despawn']);
    expect(findItem(w, theirs)).toMatchObject({ state: 'loose', x: 7, y: 7 });
    expect(findItem(w, ownNow)).toBeUndefined();
    expect(findCarryPlayer(w, 'a')).toBeUndefined();
    expect(vanPointsOf(w, 1)).toBe(1);
  });

  it('rejects duplicate and unknown players', () => {
    const w = setup();
    expect(() => addCarryPlayer(w, 'a', 3)).toThrow();
    expect(removeCarryPlayer(w, 'zz', { x: 0, y: 0 }, 0).rejected).toBe('unknown_player');
  });
});
