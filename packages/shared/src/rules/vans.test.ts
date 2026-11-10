import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { assignVans, inDepositRange, inPickupRange, nearestInReach } from './vans';

const config = loadConfig();
const entry = (id: string, joinOrder: number, team = 0, van?: number) => ({ id, joinOrder, team, van });

describe('assignVans (§4.3, §9.1, §15.3)', () => {
  it('gives free-for-all players their own slot in join order', () => {
    const vans = assignVans([entry('c', 2), entry('a', 0), entry('b', 1)], { teams: false, slotCount: 16 });
    expect(Object.fromEntries(vans)).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('keeps a slot a player held before, and fills gaps from the lowest free slot', () => {
    // 'a' left; 'b' keeps 1, 'c' keeps 2, newcomer 'd' takes the gap at 0.
    const vans = assignVans([entry('b', 1, 0, 1), entry('c', 2, 0, 2), entry('d', 3)], {
      teams: false,
      slotCount: 16,
    });
    expect(Object.fromEntries(vans)).toEqual({ b: 1, c: 2, d: 0 });
  });

  it('gives a contested previous slot to the earlier joiner', () => {
    const vans = assignVans([entry('a', 0, 0, 0), entry('b', 1, 0, 0)], { teams: false, slotCount: 4 });
    expect(Object.fromEntries(vans)).toEqual({ a: 0, b: 1 });
  });

  it('puts each team in one shared van, in the first slots', () => {
    const vans = assignVans([entry('a', 0, 2, 5), entry('b', 1, 1), entry('c', 2, 2), entry('d', 3, 1, 7)], {
      teams: true,
      slotCount: 16,
    });
    expect(Object.fromEntries(vans)).toEqual({ a: 1, b: 0, c: 1, d: 0 });
  });

  it('gives a teamless player in a teams round a van of their own after the team vans', () => {
    const vans = assignVans([entry('a', 0, 1), entry('x', 1, 0, 0), entry('b', 2, 2)], {
      teams: true,
      slotCount: 16,
    });
    expect(Object.fromEntries(vans)).toEqual({ a: 0, x: 2, b: 1 });
  });

  it('is deterministic and shares slots only when there are more players than slots', () => {
    const roster = [0, 1, 2, 3, 4].map((i) => entry(`p${i}`, i));
    const first = assignVans(roster, { teams: false, slotCount: 3 });
    expect(Object.fromEntries(first)).toEqual({ p0: 0, p1: 1, p2: 2, p3: 0, p4: 1 });
    expect(assignVans([...roster].reverse(), { teams: false, slotCount: 3 })).toEqual(first);
  });

  it('puts everyone at slot 0 on a map without vans', () => {
    expect(
      Object.fromEntries(assignVans([entry('a', 0), entry('b', 1)], { teams: false, slotCount: 0 })),
    ).toEqual({ a: 0, b: 0 });
  });
});

describe('reach checks', () => {
  const ts = config.tileSize;

  it('pickup range is pickupRangeTiles from the body centre, inclusive', () => {
    expect(inPickupRange({ x: 0, y: 0 }, { x: config.pickupRangeTiles * ts, y: 0 }, config)).toBe(true);
    expect(inPickupRange({ x: 0, y: 0 }, { x: config.pickupRangeTiles * ts + 0.1, y: 0 }, config)).toBe(
      false,
    );
  });

  it('deposit range is depositRangeTiles from the van centre', () => {
    expect(inDepositRange({ x: 10, y: 10 }, { x: 10, y: 10 + config.depositRangeTiles * ts }, config)).toBe(
      true,
    );
    expect(inDepositRange({ x: 10, y: 10 }, { x: 10, y: 11 + config.depositRangeTiles * ts }, config)).toBe(
      false,
    );
  });

  it('picks the nearest item in range, lower id on a tie', () => {
    const items = [
      { id: 3, x: 20, y: 0 },
      { id: 2, x: -20, y: 0 },
      { id: 1, x: 10, y: 1000 },
    ];
    expect(nearestInReach({ x: 0, y: 0 }, items, config)?.id).toBe(2);
    expect(nearestInReach({ x: 0, y: 500 }, items, config)).toBeUndefined();
  });
});
