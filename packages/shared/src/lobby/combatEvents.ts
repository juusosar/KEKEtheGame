// Wire contract for combat events (§15.3: hits and KOs are decided on the server; the client plays
// effects from server events). The server broadcasts one message per CombatEvent from rules/combat.ts,
// plus `attack` when someone swings, throws, sprays or places, so every client can draw the action.
import type { CombatEvent, HitSource } from '../rules/combat';
import type { AttackMode } from '../weapons/catalogue';

/** Server → client combat message types. Distinct from the item event names. */
export const CombatEventMessage = {
  /** `AttackMessage`: a player used their weapon (one swing, throw, peel, charge, or a spray step). */
  attack: 'attack',
  /** `HitMessage`: a hit landed (damage may be 0 for a pure shove or slip). */
  hit: 'hit',
  /** `KoMessage`: a player went to 0 HP. */
  ko: 'ko',
  /** `RespawnMessage`: a KO'd player is back at their van with spawn protection. */
  respawn: 'respawn',
  /** `WeaponRolledMessage`: an item pickup rolled a new weapon (§7). */
  weaponRolled: 'weaponRolled',
  /** `WeaponSpentMessage`: a weapon ran out of uses; the player is back to fists. */
  weaponSpent: 'weaponSpent',
} as const;
export type CombatEventMessageType = (typeof CombatEventMessage)[keyof typeof CombatEventMessage];

export interface AttackMessage {
  player: string;
  weapon: string;
  mode: AttackMode;
  /** Where the attack started and its aim (radians, 0 = +x, clockwise). */
  x: number;
  y: number;
  aim: number;
}
export interface HitMessage {
  source: HitSource;
  target: string;
  damage: number;
  weapon: string | null;
  /** Target HP after the hit. */
  hp: number;
}
export interface KoMessage {
  player: string;
  source: HitSource;
  weapon: string | null;
  /** Seconds until the respawn (respawnSeconds), so clients can count down without the round clock. */
  respawnInSeconds: number;
}
export interface RespawnMessage {
  player: string;
  /** Seconds of spawn protection. */
  protectedSeconds: number;
}
export interface WeaponRolledMessage {
  player: string;
  weapon: string;
  uses: number | null;
  previous: string;
}
export interface WeaponSpentMessage {
  player: string;
  weapon: string;
}

export type CombatEventWire =
  | { type: 'attack'; payload: AttackMessage }
  | { type: 'hit'; payload: HitMessage }
  | { type: 'ko'; payload: KoMessage }
  | { type: 'respawn'; payload: RespawnMessage }
  | { type: 'weaponRolled'; payload: WeaponRolledMessage }
  | { type: 'weaponSpent'; payload: WeaponSpentMessage };

/** The message type and payload the server broadcasts for one CombatEvent. `now` is the round clock. */
export function combatEventToWire(event: CombatEvent, now: number): CombatEventWire {
  switch (event.type) {
    case 'hit':
      return {
        type: 'hit',
        payload: {
          source: event.source,
          target: event.target,
          damage: event.damage,
          weapon: event.weapon,
          hp: event.hp,
        },
      };
    case 'ko':
      return {
        type: 'ko',
        payload: {
          player: event.player,
          source: event.source,
          weapon: event.weapon,
          respawnInSeconds: Math.max(0, event.respawnAt - now),
        },
      };
    case 'respawn':
      return {
        type: 'respawn',
        payload: { player: event.player, protectedSeconds: Math.max(0, event.protectedUntil - now) },
      };
    case 'weaponRolled':
      return {
        type: 'weaponRolled',
        payload: { player: event.player, weapon: event.weapon, uses: event.uses, previous: event.previous },
      };
    case 'weaponSpent':
      return { type: 'weaponSpent', payload: { player: event.player, weapon: event.weapon } };
  }
}
