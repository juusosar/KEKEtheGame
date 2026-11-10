// Timed mode (§4.1): when the round timer hits 0, players are ranked by item points deposited.
// Ties share the higher placement (standard competition ranking: 1, 1, 3). With teams on (§4.3) a
// team shares one van and one item count, so teams are ranked and every member takes the team's place.

/** One player's round result as the round flow knows it when the timer runs out. */
export interface TimedPlayerScore {
  readonly id: string;
  /** Item points this player deposited this round (normal item 1, joke item `jokeItemValue`). */
  readonly itemPoints: number;
  /** 0 = no team; 1 or 2 when teams are on (same as `PlayerState.team`). */
  readonly team: number;
}

/** A ranked side: a player (free-for-all) or a team. */
export interface Ranked {
  /** Player id, or `team:<n>` for a team (see `teamSideId`). */
  readonly id: string;
  readonly itemPoints: number;
  /** 1-based placement; tied sides share the higher (smaller) number. */
  readonly place: number;
}

export interface PlayerPlacement {
  readonly id: string;
  /** The player's own deposits this round. */
  readonly itemPoints: number;
  /** The player's placement: their own in free-for-all, their team's with teams on. */
  readonly place: number;
  /** 0 in free-for-all. */
  readonly team: number;
}

export interface TimedRoundResult {
  /** Every side, best first: players in free-for-all; teams (and any player without a team) with teams on. */
  readonly standings: readonly Ranked[];
  /** Every player, best place first, then by id. */
  readonly players: readonly PlayerPlacement[];
}

/** Id of a team side in `TimedRoundResult.standings`. */
export function teamSideId(team: number): string {
  return `team:${team}`;
}

/** True when a Timed round's clock has run out (the round flow ranks the round at this point). */
export function isTimedRoundOver(secondsLeft: number): boolean {
  return secondsLeft <= 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function checkPoints(id: string, points: number): void {
  if (!Number.isFinite(points) || points < 0) {
    throw new RangeError(`timed: item points for ${id} must be a finite number >= 0, got ${points}`);
  }
}

/**
 * Ranks sides by item points, highest first. Ties share the higher placement and the next place
 * skips (5, 5, 3 points → places 1, 1, 3). Equal sides are listed by id, so the result never depends
 * on input order. Throws on duplicate ids or on negative/non-finite points.
 */
export function rankByItemPoints(
  sides: readonly { readonly id: string; readonly itemPoints: number }[],
): Ranked[] {
  const seen = new Set<string>();
  for (const side of sides) {
    if (seen.has(side.id)) throw new RangeError(`timed: duplicate id ${side.id}`);
    seen.add(side.id);
    checkPoints(side.id, side.itemPoints);
  }
  const sorted = [...sides].sort((a, b) => b.itemPoints - a.itemPoints || compareIds(a.id, b.id));
  const ranked: Ranked[] = [];
  sorted.forEach((side, i) => {
    const prev = ranked[i - 1];
    const place = prev !== undefined && prev.itemPoints === side.itemPoints ? prev.place : i + 1;
    ranked.push({ id: side.id, itemPoints: side.itemPoints, place });
  });
  return ranked;
}

/**
 * A team's item points with Teams on: the points banked in its van (§3.2 deposits are banked, §4.3 a team
 * shares one van and one item count). Sums vans per team in case a team ever has more than one; vans with
 * team 0 (Teams off) are skipped. Pass the result to `rankTimedRound` as `teamItemPoints`.
 */
export function teamPointsFromVans(
  vans: Iterable<{ readonly team: number; readonly points: number }>,
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const van of vans) {
    if (van.team > 0) totals.set(van.team, (totals.get(van.team) ?? 0) + van.points);
  }
  return totals;
}

/**
 * Ranks a finished Timed round. Pass only the players who took part (not spectators).
 * With `teams` on, every member shares the team's place, and a team's item points are
 * `teamItemPoints.get(team)` when given (the van's banked total, so a member who left for good still
 * counts: M3 review F3), else the sum of its present members' deposits. A team is ranked only while it
 * has a member taking part. A player with team 0 still competes on their own. With `teams` off, `team`
 * and `teamItemPoints` are ignored. Per-player `itemPoints` in the result stay personal.
 */
export function rankTimedRound(
  players: readonly TimedPlayerScore[],
  teams: boolean,
  teamItemPoints?: ReadonlyMap<number, number>,
): TimedRoundResult {
  const sideOf = (p: TimedPlayerScore): string => (teams && p.team > 0 ? teamSideId(p.team) : p.id);
  const totals = new Map<string, number>();
  const ids = new Set<string>();
  for (const p of players) {
    if (ids.has(p.id)) throw new RangeError(`timed: duplicate player id ${p.id}`);
    ids.add(p.id);
    checkPoints(p.id, p.itemPoints);
    const side = sideOf(p);
    totals.set(side, (totals.get(side) ?? 0) + p.itemPoints);
  }
  if (teams && teamItemPoints) {
    for (const p of players) {
      const banked = p.team > 0 ? teamItemPoints.get(p.team) : undefined;
      if (banked === undefined) continue;
      checkPoints(teamSideId(p.team), banked);
      totals.set(teamSideId(p.team), banked);
    }
  }
  const standings = rankByItemPoints([...totals].map(([id, itemPoints]) => ({ id, itemPoints })));
  const placeOf = new Map(standings.map((s) => [s.id, s.place]));
  const placements: PlayerPlacement[] = players.map((p) => ({
    id: p.id,
    itemPoints: p.itemPoints,
    place: placeOf.get(sideOf(p)) ?? 0,
    team: teams ? p.team : 0,
  }));
  placements.sort((a, b) => a.place - b.place || compareIds(a.id, b.id));
  return { standings, players: placements };
}
