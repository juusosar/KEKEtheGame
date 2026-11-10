// Wire contract for store workers and the Wanted status (§8, §15.3; M5-3). NPCs live in the synced
// `GameState.npcs` map; these one-off events let clients play effects (swing, hit flash, KO, alarm).
import type { HitSource } from '../rules/combat';
import type { WantedEvent, WantedReason } from '../rules/wanted';

/** Server → client NPC and wanted message types. Distinct from the item and combat event names. */
export const NpcEventMessage = {
  /** `NpcAttackMessage`: an NPC swung at someone (draw the swing; hits arrive as combat `hit` events). */
  npcAttack: 'npcAttack',
  /** `NpcHitMessage`: a hit landed on an NPC (damage may be 0 for a pure shove). */
  npcHit: 'npcHit',
  /** `NpcKoMessage`: an NPC went down; it respawns at its spawn after `npcRespawnSeconds`. */
  npcKo: 'npcKo',
  /** `NpcRespawnMessage`: a KO'd NPC is back at its spawn with full HP. */
  npcRespawn: 'npcRespawn',
  /** `WantedMessage`: a player became Wanted, or a new offence restarted their timer (`refreshed`). */
  wanted: 'wanted',
  /** `WantedEndedMessage`: a player's Wanted status ran out. */
  wantedEnded: 'wantedEnded',
} as const;
export type NpcEventMessageType = (typeof NpcEventMessage)[keyof typeof NpcEventMessage];

export interface NpcAttackMessage {
  /** NPC id (key in `GameState.npcs`). */
  npc: string;
  /** Where the swing started and its aim (radians, 0 = +x, clockwise). */
  x: number;
  y: number;
  aim: number;
  /** The player it swung at ('' when none in particular). */
  target: string;
}
export interface NpcHitMessage {
  npc: string;
  source: HitSource;
  damage: number;
  weapon: string | null;
  /** NPC HP after the hit. */
  hp: number;
}
export interface NpcKoMessage {
  npc: string;
  source: HitSource;
  weapon: string | null;
  respawnInSeconds: number;
}
export interface NpcRespawnMessage {
  npc: string;
}
export interface WantedMessage {
  player: string;
  reason: WantedReason;
  /** False when the status started (play the alarm), true when an offence restarted the timer. */
  refreshed: boolean;
  /** Seconds of Wanted from now (the full `wantedSeconds`). */
  seconds: number;
  /** The guard that saw it ('witnessed'). */
  guard?: string;
  /** The NPC that was hit ('npc_damage'). */
  npc?: string;
}
export interface WantedEndedMessage {
  player: string;
}

export type NpcEventWire =
  | { type: 'npcAttack'; payload: NpcAttackMessage }
  | { type: 'npcHit'; payload: NpcHitMessage }
  | { type: 'npcKo'; payload: NpcKoMessage }
  | { type: 'npcRespawn'; payload: NpcRespawnMessage }
  | { type: 'wanted'; payload: WantedMessage }
  | { type: 'wantedEnded'; payload: WantedEndedMessage };

/** The message the server broadcasts for one WantedEvent. `now` is the round clock. */
export function wantedEventToWire(event: WantedEvent, now: number): NpcEventWire {
  if (event.type === 'wantedEnded') return { type: 'wantedEnded', payload: { player: event.player } };
  return {
    type: 'wanted',
    payload: {
      player: event.player,
      reason: event.reason,
      refreshed: event.refreshed,
      seconds: Math.max(0, event.until - now),
      ...(event.guard !== undefined ? { guard: event.guard } : {}),
      ...(event.npc !== undefined ? { npc: event.npc } : {}),
    },
  };
}
