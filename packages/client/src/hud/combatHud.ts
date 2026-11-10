// What the HUD's combat parts show (§13.2: "HP bar + current weapon icon with remaining uses", "KO
// countdown overlay"), from our own combat view (net/combatView.ts). Pure, so it is unit-tested in node.
import type { RoundPhase, WeaponCatalogue } from '@keke/shared';
import en from '../i18n/en.json';
import { t, type MessageKey } from '../i18n';
import type { CombatPlayerView } from '../net/combatView';

export type HpLevel = 'ok' | 'warn' | 'low';

export interface HudWeapon {
  id: string;
  /** Frame in the `weapons` atlas. */
  sprite: string;
  name: string;
  /** Uses left (spray: seconds); null = unlimited. */
  uses: number | null;
  /** Short text for the uses: "∞", "12", "2.4 s". */
  usesText: string;
  /** Spray uses are seconds of spraying, the rest are counts. */
  seconds: boolean;
}

export interface CombatHudModel {
  /** False for spectators, outside a round and before our player is synced: the combat HUD hides. */
  show: boolean;
  hp: number;
  maxHp: number;
  /** 0..1. */
  fill: number;
  level: HpLevel;
  weapon: HudWeapon;
  /** Set while we are KO'd: whole seconds to the respawn. */
  ko: { respawnIn: number } | null;
  stunned: boolean;
  blocking: boolean;
  protected: boolean;
}

export interface CombatHudInput {
  combat: CombatPlayerView | null;
  phase: RoundPhase;
  spectator: boolean;
  maxHp: number;
  weapons: Pick<WeaponCatalogue, 'get'>;
  warnFraction: number;
  lowFraction: number;
}

/** A weapon's display name: an i18n key `weapon.<id>` when there is one, else the name in weapons.json. */
export function weaponName(id: string, weapons: Pick<WeaponCatalogue, 'get'>): string {
  const key = `weapon.${id}`;
  if (Object.hasOwn(en, key)) return t(key as MessageKey);
  return weapons.get(id)?.name ?? id;
}

export function formatUses(uses: number | null, seconds: boolean): string {
  if (uses === null) return '∞';
  if (seconds)
    return t('hud.weapon.seconds', { seconds: (Math.ceil(Math.max(0, uses) * 10) / 10).toFixed(1) });
  return String(Math.max(0, Math.ceil(uses)));
}

export function hpLevel(fill: number, warn: number, low: number): HpLevel {
  if (fill <= low) return 'low';
  if (fill <= warn) return 'warn';
  return 'ok';
}

/** Phases with a body on the map, where HP and the weapon matter. */
const COMBAT_PHASES: ReadonlySet<RoundPhase> = new Set<RoundPhase>(['countdown', 'playing']);

export function readCombatHud(input: CombatHudInput): CombatHudModel {
  const c = input.combat;
  const weaponId = c?.weapon ?? 'fists';
  const def = input.weapons.get(weaponId);
  const seconds = def?.behaviour === 'spray';
  const uses = c?.uses ?? null;
  const maxHp = Math.max(1, input.maxHp);
  const hp = Math.max(0, Math.min(maxHp, c?.hp ?? 0));
  const fill = hp / maxHp;
  const alive = c?.alive ?? true;
  return {
    show: c !== null && !input.spectator && COMBAT_PHASES.has(input.phase),
    hp,
    maxHp,
    fill,
    level: hpLevel(fill, input.warnFraction, input.lowFraction),
    weapon: {
      id: weaponId,
      sprite: def?.sprite ?? weaponId,
      name: weaponName(weaponId, input.weapons),
      uses,
      usesText: formatUses(uses, seconds),
      seconds,
    },
    ko: alive ? null : { respawnIn: Math.max(0, Math.round(c?.respawnIn ?? 0)) },
    stunned: c?.stunned ?? false,
    blocking: c?.blocking ?? false,
    protected: c?.protected ?? false,
  };
}
