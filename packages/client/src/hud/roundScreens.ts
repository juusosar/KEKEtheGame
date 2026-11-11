// Reads the synced GameState into the full-screen round panels of §13.1: the Round intro (map, mode and
// the 3-2-1 countdown), the Round results (placement, item points, points earned, running total and
// session standing) and the Session podium (final standings, M7-1). Pure (no DOM), unit-tested in node.
// Fields come from the M3-5 round flow (PlayerState place/roundPoints/sessionPoints/…, GameState.teams).
import { teamColor, type GameMode } from '@keke/shared';
import { isBag, mapEntries, num, readLobby, readStrings, type Bag } from '../net/lobbyView';

export interface ResultRow {
  id: string;
  nickname: string;
  color: string;
  /** 0 = no team. */
  team: number;
  /** Place this round (`PlayerState.place`; the team's place with Teams on). 0 = not ranked. */
  place: number;
  /** Item points deposited this round. */
  deposited: number;
  /**
   * The Items column: what this round ranked the player on. `deposited`, except in a Race without Teams,
   * where it is the items the player's van controls (`VanState.controlled`), as the server ranks there.
   */
  items: number;
  /** Placement points earned this round. */
  roundPoints: number;
  /** Running session total of placement points. */
  sessionPoints: number;
  /** Session standing after this round (`PlayerState.sessionPlace`; the team's with Teams on). */
  sessionPlace: number;
  /** Race: this player delivered the order box (the box has left the world, so `items` can be 0). */
  delivered: boolean;
  isMe: boolean;
}

export interface ResultTeamRow {
  team: number;
  place: number;
  itemPoints: number;
  roundPoints: number;
  sessionPoints: number;
  sessionPlace: number;
  /** Member nicknames, join order. */
  members: string[];
  /** Race: a member of this team delivered the order box. */
  delivered: boolean;
  /** Our own team. */
  mine: boolean;
}

/** One side on the podium: a player, or a team with Teams on. */
export interface PodiumRow {
  /** Session id, or `team:<n>`. */
  id: string;
  /** Nickname; '' for a team (the view names it). */
  name: string;
  /** 0 for a player side. */
  team: number;
  /** Player colour, or the team colour. */
  color: string;
  /** Team member nicknames in join order; empty for a player side. */
  members: string[];
  place: number;
  points: number;
  itemPoints: number;
  /** Shares its points with a side on another place: the item points decided it (§5 tie-break). */
  tieBroken: boolean;
  mine: boolean;
}

/** Race results banner (§4.2, M6-3): who delivered, or that the 240 s cap ended the round. */
export interface RaceOutcome {
  outcome: 'delivered' | 'stolen' | 'timeUp';
  /** Deliverer's session id ('' at the time cap). */
  winner: string;
  /** Deliverer's nickname ('' at the time cap). */
  name: string;
  /** We (or our team) delivered. */
  mine: boolean;
}

/** Consecutive rounds of a session on one map (P3-2), for the podium. Rounds are 1-based. */
export interface MapStretch {
  mapId: string;
  first: number;
  last: number;
}

export type RoundScreenModel =
  | { kind: 'none' }
  | {
      kind: 'intro';
      seconds: number;
      round: number;
      totalRounds: number;
      mode: GameMode;
      /** Theme id of this round's map. */
      mapId: string;
      /** This round is on another map than the round before (P3-2): the intro says so. */
      newMap: boolean;
    }
  | {
      kind: 'results';
      seconds: number;
      round: number;
      totalRounds: number;
      /** Theme id of the map this round was played on (P3-2). */
      mapId: string;
      /** The last round of the session: the podium comes next instead of another round. */
      final: boolean;
      teams: boolean;
      /** What the player Items column counts: own deposits, or items controlled (Race without Teams). */
      items: 'deposited' | 'controlled';
      rows: ResultRow[];
      teamRows: ResultTeamRow[];
      /** Race mode only. */
      race: RaceOutcome | null;
    }
  | {
      kind: 'podium';
      seconds: number;
      teams: boolean;
      /** Rounds the session had. */
      totalRounds: number;
      /** Ranked sides, best first. */
      rows: PodiumRow[];
      /** Which map each round was on, in order (P3-2); one entry for a one-map session. */
      maps: MapStretch[];
    };

/** Unranked (0) sorts last. */
const byPlace = (a: number, b: number): number => (a === 0 ? 99 : a) - (b === 0 ? 99 : b);

export function readRoundScreen(state: unknown, mySessionId: string): RoundScreenModel {
  const lobby = readLobby(state, mySessionId);
  const s: Bag = isBag(state) ? state : {};
  const seconds = Math.max(0, Math.ceil(num(s, 'secondsLeft')));
  const round = num(s, 'round');
  const totalRounds = num(s, 'totalRounds');
  const teams = lobby.settings.teams;
  // GameState.roundMaps (P3-1): the map of each round so far; the current mapId before the first entry.
  const roundMaps = readStrings(s['roundMaps']);
  const mapOf = (r: number): string => roundMaps[r - 1] ?? lobby.mapId;

  if (lobby.phase === 'countdown') {
    const mapId = mapOf(round);
    const newMap = round > 1 && roundMaps[round - 2] !== undefined && roundMaps[round - 2] !== mapId;
    return { kind: 'intro', seconds, round, totalRounds, mode: lobby.settings.mode, mapId, newMap };
  }
  if (lobby.phase !== 'roundResults' && lobby.phase !== 'podium') return { kind: 'none' };

  const extra = new Map<string, Bag>();
  for (const [key, value] of mapEntries(s['players'])) {
    if (isBag(value)) extra.set(key, value);
  }
  const inRound = lobby.players.filter((p) => !p.spectator);
  const field = (id: string, key: string): number => num(extra.get(id) ?? {}, key);
  const myTeam = lobby.me?.team ?? 0;

  const teamBags = new Map<number, Bag>();
  if (teams) {
    for (const [, value] of mapEntries(s['teams'])) {
      if (isBag(value) && num(value, 'team') > 0) teamBags.set(num(value, 'team'), value);
    }
  }
  const membersOf = (team: number): string[] => inRound.filter((p) => p.team === team).map((p) => p.nickname);

  if (lobby.phase === 'roundResults') {
    const raceWinner =
      lobby.settings.mode === 'race' && typeof s['raceWinner'] === 'string' ? s['raceWinner'] : '';
    const winnerTeam = lobby.players.find((p) => p.id === raceWinner)?.team ?? 0;
    // Race without Teams ranks each player on the items their van controls (M6-2), so show that.
    const controlled = lobby.settings.mode === 'race' && !teams;
    const vanControlled = new Map<number, number>();
    for (const [, value] of mapEntries(s['vans'])) {
      if (isBag(value)) vanControlled.set(num(value, 'van'), num(value, 'controlled'));
    }
    const rows: ResultRow[] = inRound.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      team: p.team,
      place: field(p.id, 'place'),
      deposited: field(p.id, 'deposited'),
      items: controlled ? (vanControlled.get(field(p.id, 'van')) ?? 0) : field(p.id, 'deposited'),
      roundPoints: field(p.id, 'roundPoints'),
      sessionPoints: field(p.id, 'sessionPoints'),
      sessionPlace: field(p.id, 'sessionPlace'),
      delivered: raceWinner !== '' && p.id === raceWinner,
      isMe: p.isMe,
    }));
    rows.sort((a, b) => byPlace(a.place, b.place) || a.nickname.localeCompare(b.nickname));
    const teamRows: ResultTeamRow[] = [...teamBags.entries()]
      .map(([team, bag]) => ({
        team,
        place: num(bag, 'place'),
        itemPoints: num(bag, 'itemPoints'),
        roundPoints: num(bag, 'roundPoints'),
        sessionPoints: num(bag, 'sessionPoints'),
        sessionPlace: num(bag, 'sessionPlace'),
        members: membersOf(team),
        delivered: raceWinner !== '' && team === winnerTeam,
        mine: team === myTeam,
      }))
      .sort((a, b) => byPlace(a.place, b.place) || a.team - b.team);
    let race: RaceOutcome | null = null;
    if (lobby.settings.mode === 'race') {
      const winner = typeof s['raceWinner'] === 'string' ? s['raceWinner'] : '';
      const deliverer = lobby.players.find((p) => p.id === winner);
      const mine =
        winner !== '' &&
        (winner === lobby.me?.id ||
          (teams && myTeam > 0 && deliverer !== undefined && deliverer.team === myTeam));
      race = {
        outcome: winner === '' ? 'timeUp' : s['raceStolen'] === true ? 'stolen' : 'delivered',
        winner,
        name: deliverer?.nickname ?? '',
        mine,
      };
    }
    return {
      kind: 'results',
      seconds,
      round,
      totalRounds,
      mapId: mapOf(round),
      final: totalRounds > 0 && round >= totalRounds,
      teams,
      items: controlled ? 'controlled' : 'deposited',
      rows,
      teamRows,
      race,
    };
  }

  // Podium: sides by session place (teams with Teams on, then any teamless player on their own).
  const rows: PodiumRow[] = [];
  for (const [team, bag] of teamBags) {
    rows.push({
      id: `team:${team}`,
      name: '',
      team,
      color: teamColor(team) ?? '#888888',
      members: membersOf(team),
      place: num(bag, 'sessionPlace'),
      points: num(bag, 'sessionPoints'),
      itemPoints: num(bag, 'sessionItemPoints'),
      tieBroken: false,
      mine: team === myTeam,
    });
  }
  for (const p of inRound) {
    if (teams && p.team > 0 && teamBags.has(p.team)) continue;
    rows.push({
      id: p.id,
      name: p.nickname,
      team: 0,
      color: p.color,
      members: [],
      place: field(p.id, 'sessionPlace'),
      points: field(p.id, 'sessionPoints'),
      itemPoints: field(p.id, 'sessionItemPoints'),
      tieBroken: false,
      mine: p.isMe,
    });
  }
  rows.sort((a, b) => byPlace(a.place, b.place) || b.points - a.points || a.name.localeCompare(b.name));
  const ranked = rows.map((r) => ({
    ...r,
    tieBroken:
      r.place > 0 && rows.some((o) => o !== r && o.place > 0 && o.points === r.points && o.place !== r.place),
  }));
  return { kind: 'podium', seconds, teams, totalRounds, rows: ranked, maps: mapStretches(roundMaps) };
}

/** Groups the session's round maps into runs of consecutive rounds on one map (P3-2). */
export function mapStretches(roundMaps: readonly string[]): MapStretch[] {
  const stretches: MapStretch[] = [];
  roundMaps.forEach((mapId, i) => {
    const last = stretches[stretches.length - 1];
    if (last !== undefined && last.mapId === mapId) last.last = i + 1;
    else stretches.push({ mapId, first: i + 1, last: i + 1 });
  });
  return stretches;
}

/** Podium steps: the sides on places 1, 2 and 3 (ties share a step); everyone else is listed below. */
export function podiumSteps(rows: readonly PodiumRow[]): { steps: PodiumRow[][]; rest: PodiumRow[] } {
  const steps: PodiumRow[][] = [[], [], []];
  const rest: PodiumRow[] = [];
  for (const row of rows) {
    const step = row.place >= 1 && row.place <= 3 ? steps[row.place - 1] : undefined;
    if (step) step.push(row);
    else rest.push(row);
  }
  return { steps, rest };
}
