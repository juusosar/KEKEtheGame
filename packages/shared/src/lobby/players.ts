// Lobby roster rules: host succession (§13.1) and team balancing (§4.3).
import type { Rng } from '../rng';

/** The lobby facts these rules need about one player. */
export interface RosterEntry {
  readonly id: string;
  /** Increases with every join, so the smallest value is the longest-connected player. */
  readonly joinOrder: number;
  /** 0 = no team, 1 or 2 = team. */
  readonly team: number;
}

/** The next host: the longest-connected player, or null when nobody is left. */
export function pickHost(players: Iterable<RosterEntry>, excludeId?: string): string | null {
  let best: RosterEntry | null = null;
  for (const p of players) {
    if (p.id === excludeId) continue;
    if (best === null || p.joinOrder < best.joinOrder) best = p;
  }
  return best === null ? null : best.id;
}

/** Team for a new joiner: the smaller team, team 1 on a tie. */
export function teamForJoiner(players: Iterable<RosterEntry>): 1 | 2 {
  let one = 0;
  let two = 0;
  for (const p of players) {
    if (p.team === 1) one++;
    else if (p.team === 2) two++;
  }
  return two < one ? 2 : 1;
}

/**
 * Auto-balance: keeps everyone already on a team where possible and moves the most recent
 * joiners off the bigger team until the sizes differ by at most one. Players without a team are
 * placed on the smaller one. Returns id → team for every player.
 */
export function balanceTeams(players: readonly RosterEntry[]): Map<string, 1 | 2> {
  const byJoin = [...players].sort((a, b) => a.joinOrder - b.joinOrder);
  const result = new Map<string, 1 | 2>();
  const teams: Record<1 | 2, string[]> = { 1: [], 2: [] };
  const unassigned: string[] = [];
  for (const p of byJoin) {
    if (p.team === 1 || p.team === 2) teams[p.team].push(p.id);
    else unassigned.push(p.id);
  }
  for (const id of unassigned) {
    (teams[2].length < teams[1].length ? teams[2] : teams[1]).push(id);
  }
  while (Math.abs(teams[1].length - teams[2].length) > 1) {
    const [from, to] = teams[1].length > teams[2].length ? [teams[1], teams[2]] : [teams[2], teams[1]];
    const moved = from.pop();
    if (moved !== undefined) to.push(moved);
  }
  for (const id of teams[1]) result.set(id, 1);
  for (const id of teams[2]) result.set(id, 2);
  return result;
}

/** Host "shuffle": a random balanced split (Fisher–Yates with the seeded RNG, then alternate). */
export function shuffleTeams(ids: readonly string[], rng: Rng): Map<string, 1 | 2> {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = order[i] as string;
    order[i] = order[j] as string;
    order[j] = tmp;
  }
  const result = new Map<string, 1 | 2>();
  order.forEach((id, i) => result.set(id, i % 2 === 0 ? 1 : 2));
  return result;
}

/**
 * Start is allowed when at least one player is in and every non-spectator is ready. Players inside
 * the reconnect window (`connected: false`) neither block nor count; they rejoin the round if they
 * come back in time.
 */
export function canStart(
  players: Iterable<{ readonly ready: boolean; readonly spectator: boolean; readonly connected?: boolean }>,
): boolean {
  let count = 0;
  for (const p of players) {
    if (p.spectator || p.connected === false) continue;
    if (!p.ready) return false;
    count++;
  }
  return count > 0;
}
