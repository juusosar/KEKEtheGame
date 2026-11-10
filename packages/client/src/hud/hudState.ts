// Reads the synced GameState into what the HUD draws (§13.2): the target card and arrow, the carry
// slot, the round timer and the live scoreboard. Pure (no DOM, no Phaser) so it is unit-tested in node.
// Every field is read defensively like net/lobbyView: create()/join() resolve before the first patch,
// and fields added by later milestones (session totals from the round flow) may not exist yet.
import {
  rankTimedRound,
  teamSideId,
  vanCentre,
  type ItemCatalogue,
  type ItemRarity,
  type RoundPhase,
  type Vec2,
} from '@keke/shared';
import { isBag, mapEntries, num, readLobby, str, type Bag } from '../net/lobbyView';

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
  /** Frame in the `items` atlas. */
  sprite: string;
  rarity: ItemRarity;
  x: number;
  y: number;
}

export interface HudPlayerRow {
  id: string;
  nickname: string;
  color: string;
  /** 0 = no team. */
  team: number;
  /** Item points deposited this round (`PlayerState.deposited`). */
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

export type ArrowKind = 'target' | 'van';

export interface HudModel {
  phase: RoundPhase;
  teams: boolean;
  /** True once our own player is in the synced state. */
  synced: boolean;
  spectator: boolean;
  /** Our target (only the owner gets the card, §3.1); null while carrying or without a free spawn. */
  target: HudItem | null;
  /** What we hold, or null. */
  carried: HudItem | null;
  /** Where the arrow points, in world pixels: the target, or our van while carrying (§13.2). */
  arrow: { kind: ArrowKind; at: Vec2 } | null;
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
}

function readItem(value: unknown, catalogue: HudContext['catalogue']): HudItem | null {
  if (!isBag(value)) return null;
  const itemId = str(value, 'itemId');
  const def = catalogue.get(itemId);
  const rarity = str(value, 'rarity', def?.rarity ?? 'normal');
  return {
    id: num(value, 'id'),
    itemId,
    name: def?.name ?? itemId,
    desc: def?.desc ?? '',
    zone: def?.zone ?? '',
    sprite: def?.sprite ?? itemId,
    rarity: rarity === 'joke' ? 'joke' : 'normal',
    x: num(value, 'x'),
    y: num(value, 'y'),
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
  const itemById = (id: number): HudItem | null =>
    id === 0 ? null : readItem(items.get(String(id)), ctx.catalogue);

  const inRound = lobby.players.filter((p) => !p.spectator);
  const scores = inRound.map((p) => ({
    id: p.id,
    itemPoints: Math.max(0, num(extra.get(p.id) ?? {}, 'deposited')),
    team: p.team,
  }));
  const ranked = rankTimedRound(scores, teams);
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
      points: pointsOf.get(p.id) ?? 0,
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

  let arrow: HudModel['arrow'] = null;
  if (carried !== null) {
    const van = vanCentre(ctx.vanSlots, num(meBag, 'van', -1));
    if (van) arrow = { kind: 'van', at: { x: van.x, y: van.y } };
  } else if (target !== null) {
    arrow = { kind: 'target', at: { x: target.x, y: target.y } };
  }

  return {
    phase: lobby.phase,
    teams,
    synced: lobby.synced,
    spectator,
    target,
    carried,
    arrow,
    secondsLeft: lobby.phase === 'playing' ? Math.max(0, Math.ceil(num(s, 'secondsLeft'))) : null,
    rows,
    teamRows,
    hasSession,
  };
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
