// Pure plan of the combat FX (M4-7): which short-lived effects an `attack` or `hit` broadcast makes. Each
// attack mode has its own handler in ATTACK_FX, so a weapon behaviour plugs in by replacing one entry.
// combatFx.ts draws the specs. Frames are in the `fx` atlas (§11.1: hit spark, ketchup splat, egg splat,
// fizz burst, extinguisher cloud, banana slip, KO stars).
//
// Status per mode (M4-7): melee is complete (swing wedge, spark, damage number). thrown and shot get a
// hand puff here; their projectiles fly and splat in projectiles.ts (M4-3 state). trap: the peel is drawn
// by peels.ts from M4-5's synced traps, a slip leaves the banana slip frame (HIT_FRAMES) and spins it over
// the sliding body (combatFx). spray cones and clouds are sprayFx.ts (M4-4). charge draws a dust lane
// along the dash.
import type { AttackMessage, AttackMode, HitMessage, WeaponDef } from '@keke/shared';

export type FxFrame =
  | 'hit_spark'
  | 'ketchup_splat'
  | 'egg_splat'
  | 'fizz_burst'
  | 'extinguisher_cloud'
  | 'banana_slip'
  | 'ko_stars';

/** A filled wedge (swing arc, spray cone). */
export interface WedgeFx {
  kind: 'wedge';
  x: number;
  y: number;
  aim: number;
  rangePx: number;
  arcDegrees: number;
  color: number;
  alpha: number;
  seconds: number;
}

/** One `fx` atlas frame at a point, or following a player's body. */
export interface SpriteFx {
  kind: 'sprite';
  frame: FxFrame;
  x: number;
  y: number;
  /** Follow this player's drawn body instead of (x, y). */
  follow: string | null;
  scaleFrom: number;
  scaleTo: number;
  /** px the sprite rises over its life. */
  risePx: number;
  seconds: number;
}

/** A floating damage number over a body. */
export interface NumberFx {
  kind: 'number';
  target: string;
  text: string;
  /** CSS colour. */
  color: string;
  seconds: number;
}

/** A straight band along the aim (dash lane). */
export interface TrailFx {
  kind: 'trail';
  x: number;
  y: number;
  aim: number;
  lengthPx: number;
  widthPx: number;
  color: number;
  seconds: number;
}

export type FxSpec = WedgeFx | SpriteFx | NumberFx | TrailFx;

export interface FxConfig {
  swingFxSeconds: number;
  fxBurstSeconds: number;
  damageNumberSeconds: number;
  heldWeaponReachPx: number;
  heldWeaponLiftPx: number;
  /** Map tile size, px (charge distance is in tiles). */
  tileSize: number;
}

export type AttackFxHandler = (attack: AttackMessage, def: WeaponDef | undefined, cfg: FxConfig) => FxSpec[];

/** Where the hand is for an attack: a little ahead of the body along the aim. */
function hand(a: AttackMessage, cfg: FxConfig): { x: number; y: number } {
  return {
    x: a.x + Math.cos(a.aim) * cfg.heldWeaponReachPx,
    y: a.y - cfg.heldWeaponLiftPx + Math.sin(a.aim) * cfg.heldWeaponReachPx,
  };
}

function puff(frame: FxFrame, at: { x: number; y: number }, cfg: FxConfig, scale = 0.5): SpriteFx {
  return {
    kind: 'sprite',
    frame,
    ...at,
    follow: null,
    scaleFrom: scale * 0.6,
    scaleTo: scale,
    risePx: 0,
    seconds: cfg.fxBurstSeconds,
  };
}

/** One handler per attack mode. Replace an entry to give a behaviour its full FX. */
export const ATTACK_FX: Record<AttackMode, AttackFxHandler> = {
  melee: (a, def, cfg) => {
    const melee = def && 'melee' in def ? def.melee : null;
    if (melee === null) return [];
    return [
      {
        kind: 'wedge',
        x: a.x,
        y: a.y,
        aim: a.aim,
        rangePx: melee.rangePx,
        arcDegrees: melee.arcDegrees,
        color: 0xffffff,
        alpha: 0.35,
        seconds: cfg.swingFxSeconds,
      },
    ];
  },
  // The spray cone and the extinguisher's vision cloud are drawn by sprayFx.ts (M4-4) from the same
  // attack events; hits leave the weapon's splat (HIT_FRAMES).
  spray: () => [],
  // The egg or bottle in flight and its splat are drawn by projectiles.ts from M4-3's synced projectiles.
  thrown: (a, _def, cfg) => [puff('fizz_burst', hand(a, cfg), cfg, 0.35)],
  // The peel on the floor is drawn by peels.ts from M4-5's synced traps.
  trap: () => [],
  // The cork pops at the bottle neck; the cork in flight is a projectile (M4-3 / M4-6).
  shot: (a, _def, cfg) => [puff('fizz_burst', hand(a, cfg), cfg, 0.6)],
  charge: (a, def, cfg) => {
    if (def?.behaviour !== 'charge') return [];
    return [
      {
        kind: 'trail',
        x: a.x,
        y: a.y,
        aim: a.aim,
        lengthPx: def.charge.distanceTiles * cfg.tileSize,
        widthPx: def.charge.widthPx,
        color: 0xc8b48a,
        seconds: def.charge.distanceTiles / Math.max(1, def.charge.speedPxPerSecond / cfg.tileSize) + 0.2,
      },
    ];
  },
};

/** FX for an `attack` broadcast. */
export function attackFx(a: AttackMessage, def: WeaponDef | undefined, cfg: FxConfig): FxSpec[] {
  const handler = ATTACK_FX[a.mode] as AttackFxHandler | undefined;
  return handler ? handler(a, def, cfg) : [];
}

/** The impact frame a weapon leaves on whoever it hits. New weapons fall back to the hit spark. */
export const HIT_FRAMES: Readonly<Record<string, FxFrame>> = {
  ketchup_bottle: 'ketchup_splat',
  egg_carton: 'egg_splat',
  soda_bottle: 'fizz_burst',
  fire_extinguisher: 'extinguisher_cloud',
  banana_peels: 'banana_slip',
};

export function hitFrame(weapon: string | null): FxFrame {
  return (weapon !== null ? HIT_FRAMES[weapon] : undefined) ?? 'hit_spark';
}

/**
 * FX for a `hit` broadcast: the impact frame on the target and, when it hurt, a damage number.
 * `me` is our session id: hits on us are numbered in red.
 */
export function hitFx(h: HitMessage, me: string, cfg: FxConfig): FxSpec[] {
  const out: FxSpec[] = [
    {
      kind: 'sprite',
      frame: hitFrame(h.weapon),
      x: 0,
      y: 0,
      follow: h.target,
      scaleFrom: 0.35,
      scaleTo: 0.6,
      risePx: 0,
      seconds: cfg.fxBurstSeconds,
    },
  ];
  if (h.damage > 0) {
    out.push({
      kind: 'number',
      target: h.target,
      text: `-${Math.round(h.damage)}`,
      color: h.target === me ? '#ff5a4f' : '#ffe14d',
      seconds: cfg.damageNumberSeconds,
    });
  }
  return out;
}

/** FX for a `ko` broadcast: a big burst of stars on the body (the KO stars then circle while it lies there). */
export function koFx(player: string, cfg: FxConfig): FxSpec[] {
  return [
    {
      kind: 'sprite',
      frame: 'ko_stars',
      x: 0,
      y: 0,
      follow: player,
      scaleFrom: 0.4,
      scaleTo: 1.1,
      risePx: 10,
      seconds: cfg.fxBurstSeconds * 1.5,
    },
  ];
}
