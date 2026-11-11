// Reads the synced GameState into what the HUD draws (§13.2): the target card and arrow, the carry
// slot, the round timer and the live scoreboard. Pure (no DOM, no Phaser) so it is unit-tested in node.
// Every field is read defensively like net/lobbyView: create()/join() resolve before the first patch,
// and fields added by later milestones (session totals from the round flow) may not exist yet.
import {
  ORDER_BOX_ITEM_ID,
  rankTimedRound,
  teamPointsFromVans,
  teamSideId,
  vanCentre,
  type ItemCatalogue,
  type GameMode,
  type ItemRarity,
  type RoundPhase,
  type Vec2,
} from '@keke/shared';
import { t } from '../i18n';
import { isBag, mapEntries, num, readLobby, str, type Bag } from '../net/lobbyView';

/** Atlas of the order box icon (M6-3); every other item is a frame in the `items` atlas. */
export const ORDER_BOX_ATLAS = 'order_box';

/** An item the HUD shows: the world item joined with its catalogue entry (M3-1). */
export interface HudItem {
  /** World item id (key of `GameState.items`). */
  id: number;
  /** Catalogue id. */
  itemId: string;
  /** Finnish product name, shown as is (not translated). */
  name: string;
  /** One-line English description. */
  desc: string;
  /** Catalogue zone id (`any` for joke items). */
  zone: string;
  /** Frame in `atlas`. */
  sprite: string;
  /** `items`, or `order_box` for the race order box. */
  atlas: string;
  rarity: ItemRarity;
  x: number;
  y: number;
  /** Race (M6-3): the order box's packing van and points; null for a normal item. */
  box: { packedVan: number; points: number } | null;
}

export interface HudPlayerRow {
  id: string;
  nickname: string;
  color: string;
  /** 0 = no team. */
  team: number;
  /**
   * Item points this round: deposited (`PlayerState.deposited`) in Timed; in Race the items their van
   * controls (`VanState.controlled`: banked + own boxes carried), which the race ranks on (§4.2).
   */
  points: number;
  /** Live placement this round: own in free-for-all, the team's with teams on. Ties share. */
  place: number;
  isMe: boolean;
  connected: boolean;
  /** Placement points so far this session (M3-5 `sessionPoints`), or null while the field does not exist. */
  sessionPoints: number | null;
  /** Item points across the session (M3-5 `sessionItemPoints`), or null while the field does not exist. */
  sessionItemPoints: number | null;
}

export interface HudTeamRow {
  team: number;
  points: number;
  place: number;
}

export type ArrowKind = 'target' | 'van' | 'office' | 'box';

/**
 * Race (playtest 1 problem 6): our side's packed order box is out of our hands. `loose` = lying on the
 * floor; `taken` = carried by a rival (`by` is their nickname). A teammate carrying it is not lost.
 */
export interface HudLostBox {
  item: HudItem;
  how: 'loose' | 'taken';
  by: string;
}

/** Race HUD (§4.2, M6-3): our van's progress to the next order box. */
export interface HudRace {
  /** Our van's banked points (back to 0 at each packing). */
  points: number;
  /** `raceQuota`. */
  quota: number;
  /** Items our van controls (banked + our side's own boxes carried). */
  controlled: number;
  /** We carry an order box (ours or a stolen one): bring it to the office. */
  carryingBox: boolean;
  /** The box we carry was packed by another van. */
  stolen: boolean;
}

export interface HudModel {
  phase: RoundPhase;
  mode: GameMode;
  teams: boolean;
  /** True once our own player is in the synced state. */
  synced: boolean;
  spectator: boolean;
  /** Our target (only the owner gets the card, §3.1); null while carrying or without a free spawn. */
  target: HudItem | null;
  /** What we hold, or null. */
  carried: HudItem | null;
  /**
   * Race: our side's order box lying loose or held by a rival while our hands are empty; the card and
   * arrow point to it instead of the target. Null otherwise.
   */
  lostBox: HudLostBox | null;
  /**
   * Where the arrow points, in world pixels (§13.2): the target, our van while carrying an item, or the
   * office while carrying an order box (race).
   */
  arrow: { kind: ArrowKind; at: Vec2 } | null;
  /** Race mode, in a round, not spectating: quota progress; else null. */
  race: HudRace | null;
  /** Whole seconds left in the round while it is running, else null. */
  secondsLeft: number | null;
  /** Players in the round (not spectators), best place first. */
  rows: HudPlayerRow[];
  /** Team totals, best first; empty with teams off. */
  teamRows: HudTeamRow[];
  /** True when the server sends session totals (the full scoreboard shows those columns). */
  hasSession: boolean;
}

export interface HudContext {
  catalogue: Pick<ItemCatalogue, 'get'>;
  /** The map's van slots in slot order (`MapModel.vanSlots`). */
  vanSlots: readonly Vec2[];
  /** Race: centre of the office trigger (the arrow's goal while carrying a box); none = no office arrow. */
  office?: Vec2;
  /** Race quota from the bundled config, used only when the room has not synced `raceQuota`; defaults to 6. */
  raceQuota?: number;
  /** Atlas of the order box sheet for the room's map (P1-5); defaults to the default theme's. */
  orderBoxAtlas?: string;
}

const DEFAULT_RACE_QUOTA = 6;

function readItem(value: unknown, ctx: HudContext): HudItem | null {
  const catalogue = ctx.catalogue;
  if (!isBag(value)) return null;
  const itemId = str(value, 'itemId');
  if (itemId === ORDER_BOX_ITEM_ID) {
    return {
      id: num(value, 'id'),
      itemId,
      name: t('item.orderBox'),
      desc: t('item.orderBox.desc'),
      zone: '',
      sprite: ORDER_BOX_ITEM_ID,
      atlas: ctx.orderBoxAtlas ?? ORDER_BOX_ATLAS,
      rarity: 'normal',
      x: num(value, 'x'),
      y: num(value, 'y'),
      box: { packedVan: num(value, 'packedVan', -1), points: num(value, 'points') },
    };
  }
  const def = catalogue.get(itemId);
  const rarity = str(value, 'rarity', def?.rarity ?? 'normal');
  return {
    id: num(value, 'id'),
    itemId,
    name: def?.name ?? itemId,
    desc: def?.desc ?? '',
    zone: def?.zone ?? '',
    sprite: def?.sprite ?? itemId,
    atlas: 'items',
    rarity: rarity === 'joke' ? 'joke' : 'normal',
    x: num(value, 'x'),
    y: num(value, 'y'),
    box: null,
  };
}

const optionalNum = (bag: Bag, key: string): number | null =>
  typeof bag[key] === 'number' && Number.isFinite(bag[key]) ? bag[key] : null;

export function readHud(state: unknown, mySessionId: string, ctx: HudContext): HudModel {
  const lobby = readLobby(state, mySessionId);
  const s: Bag = isBag(state) ? state : {};
  const teams = lobby.settings.teams;

  // Per-player fields the lobby view does not read.
  const extra = new Map<string, Bag>();
  for (const [key, value] of mapEntries(s['players'])) {
    if (isBag(value)) extra.set(str(value, 'sessionId', key) || key, value);
  }
  const items = new Map<string, unknown>(mapEntries(s['items']));
  const itemById = (id: number): HudItem | null => (id === 0 ? null : readItem(items.get(String(id)), ctx));

  const race = lobby.settings.mode === 'race';
  const inRound = lobby.players.filter((p) => !p.spectator);
  const vanBags = mapEntries(s['vans']).map(([key, v]) => {
    const bag: Bag = isBag(v) ? v : {};
    const points = Math.max(0, num(bag, 'points'));
    return {
      van: num(bag, 'van', Number(key) || 0),
      team: num(bag, 'team'),
      points,
      controlled: Math.max(0, num(bag, 'controlled', points)),
      quota: Math.max(0, num(bag, 'quota')),
    };
  });
  const vanOf = (id: string): (typeof vanBags)[number] | undefined => {
    const van = num(extra.get(id) ?? {}, 'van', -1);
    return van < 0 ? undefined : vanBags.find((v) => v.van === van);
  };
  // Race ranks on "items you control" per van (§4.2; teammates share one); Timed on deposits.
  const scores = inRound.map((p) => ({
    id: p.id,
    itemPoints: race ? (vanOf(p.id)?.controlled ?? 0) : Math.max(0, num(extra.get(p.id) ?? {}, 'deposited')),
    team: p.team,
  }));
  // Teams: the van's banked total, as the server ranks it (M3 review F3); in Race what the van controls.
  const vans = vanBags.map((v) => ({ team: v.team, points: race ? v.controlled : v.points }));
  const ranked = rankTimedRound(scores, teams, teams ? teamPointsFromVans(vans) : undefined);
  const placeOf = new Map(ranked.players.map((r) => [r.id, r.place]));
  const pointsOf = new Map(scores.map((r) => [r.id, r.itemPoints]));

  let hasSession = false;
  const rows: HudPlayerRow[] = inRound.map((p) => {
    const bag = extra.get(p.id) ?? {};
    const sessionPoints = optionalNum(bag, 'sessionPoints');
    if (sessionPoints !== null) hasSession = true;
    return {
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      team: p.team,
      // Race + Teams (playtest 1 problem 7): the van total is the team row's; each member shows their own
      // deposits instead of the same total four times.
      points: race && teams ? Math.max(0, num(bag, 'deposited')) : (pointsOf.get(p.id) ?? 0),
      place: placeOf.get(p.id) ?? 0,
      isMe: p.isMe,
      connected: p.connected,
      sessionPoints,
      sessionItemPoints: optionalNum(bag, 'sessionItemPoints'),
    };
  });
  rows.sort((a, b) => a.place - b.place || b.points - a.points || a.nickname.localeCompare(b.nickname));

  const teamRows: HudTeamRow[] = [];
  if (teams) {
    for (const side of ranked.standings) {
      for (const team of [1, 2]) {
        if (side.id === teamSideId(team)) teamRows.push({ team, points: side.itemPoints, place: side.place });
      }
    }
  }

  const meBag = lobby.me ? (extra.get(lobby.me.id) ?? {}) : {};
  const spectator = lobby.me?.spectator ?? false;
  const inPlay = lobby.me !== null && !spectator && lobby.phase !== 'lobby';
  const carried = inPlay ? itemById(num(meBag, 'carrying')) : null;
  const target = inPlay && carried === null ? itemById(num(meBag, 'target')) : null;
  const lostBox =
    race && inPlay && carried === null ? findLostBox(items, extra, num(meBag, 'van', -1), lobby, ctx) : null;

  let arrow: HudModel['arrow'] = null;
  if (lostBox !== null) {
    arrow = { kind: 'box', at: { x: lostBox.item.x, y: lostBox.item.y } };
  } else if (carried?.box && ctx.office) {
    arrow = { kind: 'office', at: { x: ctx.office.x, y: ctx.office.y } };
  } else if (carried !== null) {
    const van = vanCentre(ctx.vanSlots, num(meBag, 'van', -1));
    if (van) arrow = { kind: 'van', at: { x: van.x, y: van.y } };
  } else if (target !== null) {
    arrow = { kind: 'target', at: { x: target.x, y: target.y } };
  }

  let raceHud: HudRace | null = null;
  if (race && inPlay) {
    const van = lobby.me ? vanOf(lobby.me.id) : undefined;
    raceHud = {
      points: van?.points ?? 0,
      // Our van's own quota (bigger for a team van, playtest 1), else the room's synced quota, which wins
      // over the bundled config (M6 review F5).
      quota:
        (van?.quota ?? 0) > 0
          ? (van?.quota ?? 0)
          : num(s, 'raceQuota') > 0
            ? num(s, 'raceQuota')
            : (ctx.raceQuota ?? DEFAULT_RACE_QUOTA),
      controlled: van?.controlled ?? 0,
      carryingBox: carried?.box != null,
      stolen: carried?.box != null && carried.box.packedVan !== num(meBag, 'van', -1),
    };
  }

  return {
    phase: lobby.phase,
    mode: lobby.settings.mode,
    teams,
    synced: lobby.synced,
    spectator,
    target,
    carried,
    lostBox,
    arrow,
    race: raceHud,
    secondsLeft: lobby.phase === 'playing' ? Math.max(0, Math.ceil(num(s, 'secondsLeft'))) : null,
    rows,
    teamRows,
    hasSession,
  };
}

/**
 * Our side's packed order box when it is out of our side's hands (playtest 1 problem 6): lying loose, or
 * carried by a player of another van. A carried box is drawn at its carrier, so it takes their position.
 */
function findLostBox(
  items: ReadonlyMap<string, unknown>,
  players: ReadonlyMap<string, Bag>,
  myVan: number,
  lobby: ReturnType<typeof readLobby>,
  ctx: HudContext,
): HudLostBox | null {
  if (myVan < 0) return null;
  for (const value of items.values()) {
    if (!isBag(value) || str(value, 'itemId') !== ORDER_BOX_ITEM_ID) continue;
    if (num(value, 'packedVan', -1) !== myVan) continue;
    const state = str(value, 'state');
    const box = readItem(value, ctx);
    if (box === null) continue;
    if (state === 'loose') return { item: box, how: 'loose', by: '' };
    if (state !== 'carried') continue;
    const carrier = str(value, 'carrier');
    const bag = players.get(carrier);
    if (bag === undefined || num(bag, 'van', -1) === myVan) continue;
    const nickname = lobby.players.find((p) => p.id === carrier)?.nickname ?? carrier;
    return { item: { ...box, x: num(bag, 'x'), y: num(bag, 'y') }, how: 'taken', by: nickname };
  }
  return null;
}

/** The mini scoreboard (§13.2): the top `count` rows, plus our own row when we are below them. */
export function miniRows(rows: readonly HudPlayerRow[], count: number): HudPlayerRow[] {
  const top = rows.slice(0, count);
  const me = rows.find((r) => r.isMe);
  if (me && !top.includes(me)) top.push(me);
  return top;
}

/** Round clock text: `m:ss`. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
