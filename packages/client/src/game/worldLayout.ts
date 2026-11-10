// Pure rules for how items and vans are drawn (M3-6): which colour outlines them and where a carried
// item sits. Kept free of Phaser so they are unit-tested; game/worldItems.ts does the drawing.
import { teamColor } from '@keke/shared';
import type { WorldItemView, WorldVanView, WorldView } from '../net/worldView';

/** What the outlines need to know about a player. */
export interface OutlinePlayer {
  id: string;
  /** `#RRGGBB`. */
  color: string;
  /** 0 = no team, 1 or 2. */
  team: number;
}

/** A player's outline colour: the team colour with Teams on (§4.3), otherwise their own colour. */
export function playerOutlineColor(player: OutlinePlayer, teams: boolean): string {
  return (teams ? teamColor(player.team) : undefined) ?? player.color;
}

/**
 * §3.1: every target is outlined in its owner's colour, for everyone. Loose and carried items have no
 * owner, so no outline. Undefined while the owner is not (yet) in the roster.
 */
export function itemOutlineColor(
  item: Pick<WorldItemView, 'state' | 'owner'>,
  players: ReadonlyMap<string, OutlinePlayer>,
  teams: boolean,
): string | undefined {
  if (item.state !== 'target' || item.owner === '') return undefined;
  const owner = players.get(item.owner);
  return owner ? playerOutlineColor(owner, teams) : undefined;
}

/**
 * Colour framing a van: the team colour for a team van, otherwise the colour of the player who has
 * it (the lowest join order wins if the state ever shows two). Undefined for a van nobody has.
 */
export function vanOutlineColor(
  van: WorldVanView,
  world: Pick<WorldView, 'players' | 'teams'>,
  players: readonly OutlinePlayer[],
): string | undefined {
  if (world.teams) {
    const team = teamColor(van.team);
    if (team) return team;
  }
  const owner = players.find((p) => world.players.get(p.id)?.van === van.van);
  return owner ? playerOutlineColor(owner, world.teams) : undefined;
}

/** Atlas frame of a van (0-based slot) in the 'van' atlas: painted `slot_1`..`slot_16`. */
export function vanFrame(van: number): string {
  return `slot_${van + 1}`;
}

/** Centre y of an item `frameHeight` px tall carried above a player standing at `carrierY`. */
export function carriedItemCentreY(carrierY: number, frameHeight: number, gapPx: number): number {
  return carrierY - gapPx - frameHeight / 2;
}

/**
 * Pixels to raise a carrier's nameplate so it clears the item above their head: the part of the
 * item above the nameplate's normal bottom edge.
 */
export function nameplateLift(frameHeight: number, gapPx: number, nameplateOffsetY: number): number {
  return Math.max(0, gapPx + frameHeight - nameplateOffsetY);
}

/** Joke-item twinkle (§10.1) brightness at time `t` seconds: 0..1, peaking once per period. */
export function twinkle(t: number, periodSeconds: number): number {
  const phase = (((t / periodSeconds) % 1) + 1) % 1;
  // A short flash in the first fifth of the period, dark the rest of the time.
  return phase < 0.2 ? Math.sin((phase / 0.2) * Math.PI) : 0;
}
