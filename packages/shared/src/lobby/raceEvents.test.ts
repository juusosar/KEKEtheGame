import { describe, expect, it } from 'vitest';
import type { WorldItem } from '../rules/carry';
import type { OrderBox } from '../rules/carry';
import { ORDER_BOX_ITEM_ID } from '../rules/modes/race';
import { RaceEventMessage, raceEventToWire } from './raceEvents';

const box: WorldItem & { box: OrderBox } = {
  id: 12,
  itemId: ORDER_BOX_ITEM_ID,
  rarity: 'normal',
  state: 'carried',
  x: 5,
  y: 6,
  owner: null,
  carrier: 'b',
  looseSince: null,
  box: { van: 1, points: 7, packedBy: 'a' },
};
const wire = { id: 12, itemId: ORDER_BOX_ITEM_ID, rarity: 'normal', x: 5, y: 6 };

describe('raceEventToWire', () => {
  it('sends boxPacked with the box as a wire item and its points', () => {
    expect(raceEventToWire({ type: 'boxPacked', player: 'a', van: 1, box })).toEqual({
      type: RaceEventMessage.boxPacked,
      payload: { player: 'a', van: 1, box: wire, points: 7 },
    });
  });

  it('sends delivery with the packing van and whether it was stolen', () => {
    expect(raceEventToWire({ type: 'delivery', player: 'b', van: 2, box, stolen: true })).toEqual({
      type: RaceEventMessage.delivery,
      payload: { player: 'b', van: 2, box: wire, packedVan: 1, points: 7, stolen: true },
    });
  });
});
