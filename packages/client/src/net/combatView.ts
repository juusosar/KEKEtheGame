// Reads each player's combat fields from the synced GameState (M4-2 PlayerState) for prediction, the
// avatars and the debug hook; M4-7's HUD (HP bar, weapon and uses, KO overlay) reads the same view.
// Read defensively, like lobbyView: a missing field falls back to its schema default.
import { carryMultiplier, syncedCombatSpeed, type GameConfig, type WeaponCatalogue } from '@keke/shared';
import { bool, isBag, mapEntries, num, str } from './lobbyView';

export interface CombatPlayerView {
  hp: number;
  alive: boolean;
  /** Held weapon id ('fists' when nothing else). */
  weapon: string;
  /** Uses left (spray: seconds); null = unlimited. */
  uses: number | null;
  stunned: boolean;
  slowMultiplier: number;
  /** Spawn protection after a respawn. */
  protected: boolean;
  /** Holding Block with a pan (M4-6). */
  blocking: boolean;
  /** Dashing with a pallet jack (M4-6): input does not move the body. */
  charging: boolean;
  /** Whole seconds until the respawn while KO'd; 0 while alive. */
  respawnIn: number;
  /** Slipped on a banana peel: sliding out of control (M4-5). */
  sliding: boolean;
  /** Aim of the player's last applied input, radians (PlayerState.aim): the held weapon points here. */
  aim: number;
}

export const DEFAULT_COMBAT: CombatPlayerView = Object.freeze({
  hp: 0,
  alive: true,
  weapon: 'fists',
  uses: null,
  stunned: false,
  slowMultiplier: 1,
  protected: false,
  blocking: false,
  charging: false,
  respawnIn: 0,
  sliding: false,
  aim: 0,
});

/** Combat fields of every player, keyed by session id. */
export function readCombat(state: unknown): Map<string, CombatPlayerView> {
  const out = new Map<string, CombatPlayerView>();
  if (!isBag(state)) return out;
  for (const [key, value] of mapEntries(state['players'])) {
    if (!isBag(value)) continue;
    const uses = num(value, 'weaponUses', -1);
    out.set(str(value, 'sessionId', key) || key, {
      hp: num(value, 'hp'),
      alive: bool(value, 'alive', true),
      weapon: str(value, 'weapon', 'fists') || 'fists',
      uses: uses < 0 ? null : uses,
      stunned: bool(value, 'stunned'),
      slowMultiplier: num(value, 'slowMultiplier', 1),
      protected: bool(value, 'protected'),
      blocking: bool(value, 'blocking'),
      charging: bool(value, 'charging'),
      respawnIn: num(value, 'respawnIn'),
      sliding: bool(value, 'sliding'),
      aim: num(value, 'aim'),
    });
  }
  return out;
}

/**
 * The speed multiplier the server moves us with, from synced state only (M2 review H1): carry slowdown
 * times the combat part (0 while KO'd, stunned or charging, slow). Same formula as the server's
 * GameRoom.tick modifiers. The pan block is per frame: see `blockSpeed`.
 */
export function predictionSpeed(
  combat: CombatPlayerView,
  carrying: boolean,
  config: Pick<GameConfig, 'carrySpeedMultiplier'>,
): number {
  return (
    carryMultiplier(config, carrying) *
    syncedCombatSpeed({
      alive: combat.alive,
      stunned: combat.stunned,
      slowMultiplier: combat.slowMultiplier,
      charging: combat.charging,
    })
  );
}

/**
 * Speed multiplier for our frames that hold Block (M4 review F7), or undefined when we cannot raise a
 * block now (no pan, KO'd, stunned). Same rule as the server's CombatSystem.blockSpeedMultiplier, so a
 * block press needs no correction.
 */
export function blockSpeed(combat: CombatPlayerView, weapons: WeaponCatalogue): number | undefined {
  if (!combat.alive || combat.stunned) return undefined;
  return weapons.get(combat.weapon)?.block?.moveSpeedMultiplier;
}
