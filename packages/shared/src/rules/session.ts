// Session scoring (§5): each round's placement gives placement points; the session winner has the
// most points, with total item points deposited across the session as the tie-break.
import type { GameConfig } from '../config';

/** Placement points for a round place (1-based): `placementPoints[place - 1]`, else `placementPointsOther`. */
export function placementPointsFor(
  place: number,
  config: Pick<GameConfig, 'placementPoints' | 'placementPointsOther'>,
): number {
  if (!Number.isInteger(place) || place < 1) {
    throw new RangeError(`session: place must be an integer >= 1, got ${place}`);
  }
  return config.placementPoints[place - 1] ?? config.placementPointsOther;
}

/** One side's running session total: a player (free-for-all) or a team. */
export interface SessionSide {
  readonly id: string;
  /** Placement points summed over the rounds played so far. */
  readonly points: number;
  /** Item points deposited over the rounds played so far (tie-break). */
  readonly itemPoints: number;
}

export interface SessionStanding extends SessionSide {
  /** 1-based; sides equal on both points and item points share the higher place (1, 1, 3). */
  readonly place: number;
}

function check(side: SessionSide): void {
  for (const value of [side.points, side.itemPoints]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`session: totals for ${side.id} must be finite numbers >= 0`);
    }
  }
}

/**
 * Ranks session totals: most placement points first, then most item points (§5 tie-break). Sides
 * still equal share the higher place and the next place skips. Equal sides are listed by id.
 * Throws on duplicate ids or negative/non-finite totals.
 */
export function rankSession(sides: readonly SessionSide[]): SessionStanding[] {
  const seen = new Set<string>();
  for (const side of sides) {
    if (seen.has(side.id)) throw new RangeError(`session: duplicate id ${side.id}`);
    seen.add(side.id);
    check(side);
  }
  const sorted = [...sides].sort(
    (a, b) => b.points - a.points || b.itemPoints - a.itemPoints || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const ranked: SessionStanding[] = [];
  sorted.forEach((side, i) => {
    const prev = ranked[i - 1];
    const tied = prev !== undefined && prev.points === side.points && prev.itemPoints === side.itemPoints;
    ranked.push({
      id: side.id,
      points: side.points,
      itemPoints: side.itemPoints,
      place: tied ? prev.place : i + 1,
    });
  });
  return ranked;
}
