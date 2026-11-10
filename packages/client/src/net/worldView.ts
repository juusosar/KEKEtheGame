// Reads the items and vans of the synced GameState (M3-4 schema) for the world renderer, the HUD and
// the minimap: world items, banked van points and each player's van, carried item, target and
// deposited points. Read defensively, like lobbyView: a missing field falls back to its schema default.
import { isBag, mapEntries, num, str, bool } from './lobbyView';

export type WorldItemState = 'target' | 'loose' | 'carried';

export interface WorldItemView {
  /** World item id (unique within the round). */
  id: number;
  /** Catalogue item id. */
  itemId: string;
  rarity: 'normal' | 'joke';
  state: WorldItemState;
  /** Where it lies; for a carried item the carrier's server position. */
  x: number;
  y: number;
  /** Session id of the player it is the target of ('' unless state is 'target'). */
  owner: string;
  /** Session id of the player carrying it ('' unless state is 'carried'). */
  carrier: string;
  /** Race (M6-2): van slot that packed this order box; -1 for a normal item. */
  packedVan: number;
  /** Race: item points packed into this order box; 0 for a normal item. */
  points: number;
}

export interface WorldVanView {
  /** 0-based van slot: map van `index` and art frame `slot_<van + 1>`. */
  van: number;
  /** Item points banked this round. */
  points: number;
  /** 0 when teams are off. */
  team: number;
  /** Race (M6-2): "items you control" (banked + own boxes carried by this van's players); = points in Timed. */
  controlled: number;
}

/** The item fields of one player (PlayerState, M3-4). */
export interface WorldPlayerView {
  /** 0-based van slot, -1 before the first round. */
  van: number;
  /** World item id carried, 0 = none. */
  carrying: number;
  /** World item id of the current target, 0 = none. */
  target: number;
  /** Item points deposited this round. */
  deposited: number;
}

export interface WorldView {
  /** Sorted by id. */
  items: WorldItemView[];
  /** Sorted by van slot. */
  vans: WorldVanView[];
  /** Keyed by session id. */
  players: Map<string, WorldPlayerView>;
  /** Room setting: team colours replace player colours on outlines (§4.3). */
  teams: boolean;
}

const ITEM_STATES: readonly string[] = ['target', 'loose', 'carried'] satisfies WorldItemState[];

export function readWorld(state: unknown): WorldView {
  const view: WorldView = { items: [], vans: [], players: new Map(), teams: false };
  if (!isBag(state)) return view;

  for (const [key, value] of mapEntries(state['items'])) {
    if (!isBag(value)) continue;
    const id = num(value, 'id', Number(key) || 0);
    if (id <= 0) continue;
    const itemState = str(value, 'state', 'target');
    view.items.push({
      id,
      itemId: str(value, 'itemId'),
      rarity: str(value, 'rarity') === 'joke' ? 'joke' : 'normal',
      state: (ITEM_STATES.includes(itemState) ? itemState : 'target') as WorldItemState,
      x: num(value, 'x'),
      y: num(value, 'y'),
      owner: str(value, 'owner'),
      carrier: str(value, 'carrier'),
      packedVan: num(value, 'packedVan', -1),
      points: num(value, 'points'),
    });
  }
  view.items.sort((a, b) => a.id - b.id);

  for (const [key, value] of mapEntries(state['vans'])) {
    if (!isBag(value)) continue;
    view.vans.push({
      van: num(value, 'van', Number(key) || 0),
      points: num(value, 'points'),
      team: num(value, 'team'),
      controlled: num(value, 'controlled', num(value, 'points')),
    });
  }
  view.vans.sort((a, b) => a.van - b.van);

  for (const [key, value] of mapEntries(state['players'])) {
    if (!isBag(value)) continue;
    view.players.set(str(value, 'sessionId', key) || key, {
      van: num(value, 'van', -1),
      carrying: num(value, 'carrying'),
      target: num(value, 'target'),
      deposited: num(value, 'deposited'),
    });
  }

  const settings = state['settings'];
  view.teams = isBag(settings) && bool(settings, 'teams');
  return view;
}
