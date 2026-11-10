// Wire contract for item events (§15.3: the client plays effects from server events). The server
// broadcasts one message per ItemEvent from the carry rules; only the catalogue item id goes over the
// wire, clients look up name, description and sprite locally (M3-1).
import type { ItemRarity } from '../items/catalogue';
import type { DropReason, ItemEvent, PickupKind, WorldItem } from '../rules/carry';

/** Server → client item event message types, one per ItemEvent type. */
export const ItemEventMessage = {
  /** `TargetAssignedMessage`: a player got a new target. */
  targetAssigned: 'targetAssigned',
  /** `PickupMessage`: a player picked up an item. */
  pickup: 'pickup',
  /** `DropMessage`: a carried item dropped loose (drop key, KO or disconnect). */
  drop: 'drop',
  /** `DepositMessage`: a player banked an item in their van. */
  deposit: 'deposit',
  /** `DespawnMessage`: a loose item expired, or a leaver's target went away. */
  despawn: 'despawn',
} as const;
export type ItemEventMessageType = (typeof ItemEventMessage)[keyof typeof ItemEventMessage];

/** An item as sent in events. `id` is the world item id (key of `GameState.items`). */
export interface WireItem {
  id: number;
  itemId: string;
  rarity: ItemRarity;
  x: number;
  y: number;
}

export interface TargetAssignedMessage {
  player: string;
  item: WireItem;
}
export interface PickupMessage {
  player: string;
  item: WireItem;
  kind: PickupKind;
  /** For kind `other_target`: whose target was taken (they get a new one). */
  targetOwner: string | null;
}
export interface DropMessage {
  player: string;
  item: WireItem;
  reason: DropReason;
}
export interface DepositMessage {
  player: string;
  item: WireItem;
  /** Van slot (0-based) that banked the points. */
  van: number;
  points: number;
  vanTotal: number;
}
export interface DespawnMessage {
  item: WireItem;
}

export type ItemEventWire =
  | { type: 'targetAssigned'; payload: TargetAssignedMessage }
  | { type: 'pickup'; payload: PickupMessage }
  | { type: 'drop'; payload: DropMessage }
  | { type: 'deposit'; payload: DepositMessage }
  | { type: 'despawn'; payload: DespawnMessage };

export function wireItem(item: WorldItem): WireItem {
  return { id: item.id, itemId: item.itemId, rarity: item.rarity, x: item.x, y: item.y };
}

/** The message type and payload the server broadcasts for one ItemEvent. */
export function itemEventToWire(event: ItemEvent): ItemEventWire {
  const item = wireItem(event.item);
  switch (event.type) {
    case 'targetAssigned':
      return { type: event.type, payload: { player: event.player, item } };
    case 'pickup':
      return {
        type: event.type,
        payload: { player: event.player, item, kind: event.kind, targetOwner: event.targetOwner },
      };
    case 'drop':
      return { type: event.type, payload: { player: event.player, item, reason: event.reason } };
    case 'deposit':
      return {
        type: event.type,
        payload: {
          player: event.player,
          item,
          van: event.van,
          points: event.points,
          vanTotal: event.vanTotal,
        },
      };
    case 'despawn':
      return { type: event.type, payload: { item } };
  }
}
