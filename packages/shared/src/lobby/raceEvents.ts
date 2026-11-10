// Wire contract for race-mode events (§4.2, §15.3; M6-1). The order box itself travels as a normal item
// (itemId `ORDER_BOX_ITEM_ID`) in `GameState.items` and in item events (pickup kind 'box', drop); these
// two events mark the race milestones so clients can play effects and the event feed can announce them.
import type { RaceEvent } from '../rules/modes/race';
import { wireItem, type WireItem } from './itemEvents';

/** Server → client race message types. Distinct from the item, combat and NPC event names. */
export const RaceEventMessage = {
  /** `BoxPackedMessage`: a van reached the quota; its items were packed and `player` carries the box. */
  boxPacked: 'boxPacked',
  /** `DeliveryMessage`: a box was delivered to the office; the round ends. */
  delivery: 'delivery',
} as const;
export type RaceEventMessageType = (typeof RaceEventMessage)[keyof typeof RaceEventMessage];

export interface BoxPackedMessage {
  player: string;
  /** Van slot (0-based) whose items were packed. Its banked total is now 0. */
  van: number;
  /** The box (world item id = key of `GameState.items`). */
  box: WireItem;
  /** Item points packed into the box. */
  points: number;
}
export interface DeliveryMessage {
  /** The deliverer: they (their team) win the round. */
  player: string;
  /** The deliverer's van. */
  van: number;
  box: WireItem;
  /** Van that packed the box. */
  packedVan: number;
  points: number;
  /** True when the box was packed by another van (stolen and delivered). */
  stolen: boolean;
}

export type RaceEventWire =
  { type: 'boxPacked'; payload: BoxPackedMessage } | { type: 'delivery'; payload: DeliveryMessage };

/** The message type and payload the server broadcasts for one RaceEvent. */
export function raceEventToWire(event: RaceEvent): RaceEventWire {
  const box = wireItem(event.box);
  switch (event.type) {
    case 'boxPacked':
      return {
        type: event.type,
        payload: { player: event.player, van: event.van, box, points: event.box.box.points },
      };
    case 'delivery':
      return {
        type: event.type,
        payload: {
          player: event.player,
          van: event.van,
          box,
          packedVan: event.box.box.van,
          points: event.box.box.points,
          stolen: event.stolen,
        },
      };
  }
}
