// Reads the synced GameState into the full-screen round panels of §13.1: the Round intro (map, mode and
// the 3-2-1 countdown), the Round results (placement, item points, points earned, running total) and a
// plain Session podium (final standings; M7-1 dresses it up). Pure (no DOM), unit-tested in node.
// Fields come from the M3-5 round flow (PlayerState place/roundPoints/sessionPoints/…, GameState.teams).
import type { GameMode } from '@keke/shared';
import { isBag, mapEntries, num, readLobby, type Bag } from '../net/lobbyView';

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
  /** Placement points earned this round. */
  roundPoints: number;
  /** Running session total of placement points. */
  sessionPoints: number;
  isMe: boolean;
}

export interface ResultTeamRow {
  team: number;
  place: number;
  itemPoints: number;
  roundPoints: number;
  sessionPoints: number;
  /** Member nicknames, join order. */
  members: string[];
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
  place: number;
  points: number;
  itemPoints: number;
  mine: boolean;
}

export type RoundScreenModel =
  | { kind: 'none' }
  | { kind: 'intro'; seconds: number; round: number; totalRounds: number; mode: GameMode }
  | {
      kind: 'results';
      seconds: number;
      round: number;
      totalRounds: number;
      /** The last round of the session: the podium comes next instead of another round. */
      final: boolean;
      teams: boolean;
      rows: ResultRow[];
      teamRows: ResultTeamRow[];
    }
  | { kind: 'podium'; seconds: number; teams: boolean; rows: PodiumRow[] };

/** Unranked (0) sorts last. */
const byPlace = (a: number, b: number): number => (a === 0 ? 99 : a) - (b === 0 ? 99 : b);

export function readRoundScreen(state: unknown, mySessionId: string): RoundScreenModel {
  const lobby = readLobby(state, mySessionId);
  const s: Bag = isBag(state) ? state : {};
  const seconds = Math.max(0, Math.ceil(num(s, 'secondsLeft')));
  const round = num(s, 'round');
  const totalRounds = num(s, 'totalRounds');
  const teams = lobby.settings.teams;

  if (lobby.phase === 'countdown') {
    return { kind: 'intro', seconds, round, totalRounds, mode: lobby.settings.mode };
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
    const rows: ResultRow[] = inRound.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      team: p.team,
      place: field(p.id, 'place'),
      deposited: field(p.id, 'deposited'),
      roundPoints: field(p.id, 'roundPoints'),
      sessionPoints: field(p.id, 'sessionPoints'),
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
        members: membersOf(team),
        mine: team === myTeam,
      }))
      .sort((a, b) => byPlace(a.place, b.place) || a.team - b.team);
    return {
      kind: 'results',
      seconds,
      round,
      totalRounds,
      final: totalRounds > 0 && round >= totalRounds,
      teams,
      rows,
      teamRows,
    };
  }

  // Podium: sides by session place (teams with Teams on, then any teamless player on their own).
  const rows: PodiumRow[] = [];
  for (const [team, bag] of teamBags) {
    rows.push({
      id: `team:${team}`,
      name: '',
      team,
      place: num(bag, 'sessionPlace'),
      points: num(bag, 'sessionPoints'),
      itemPoints: num(bag, 'sessionItemPoints'),
      mine: team === myTeam,
    });
  }
  for (const p of inRound) {
    if (teams && p.team > 0 && teamBags.has(p.team)) continue;
    rows.push({
      id: p.id,
      name: p.nickname,
      team: 0,
      place: field(p.id, 'sessionPlace'),
      points: field(p.id, 'sessionPoints'),
      itemPoints: field(p.id, 'sessionItemPoints'),
      mine: p.isMe,
    });
  }
  rows.sort((a, b) => byPlace(a.place, b.place) || b.points - a.points || a.name.localeCompare(b.name));
  return { kind: 'podium', seconds, teams, rows };
}
