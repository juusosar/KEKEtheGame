// Weapon catalogue (§7): schema, validation and lookups. Every weapon stat lives in data/weapons.json, so
// adding a weapon needs no code unless it brings a new behaviour type (§7). The §7 table is copied in
// tools/weapons/weapons.md and a test keeps the two in step.
import { z } from 'zod';
import { ConfigError, formatIssues } from '../config';
import weaponsJson from '../data/weapons.json';

/** Behaviour types from §7. `block` is not a behaviour but an optional modifier on any weapon. */
export const WEAPON_BEHAVIOURS = ['melee', 'spray', 'thrown', 'trap', 'shot_then_melee', 'charge'] as const;
export type WeaponBehaviour = (typeof WEAPON_BEHAVIOURS)[number];

/** Rarities a pickup can roll. */
export const ROLL_RARITIES = ['common', 'uncommon', 'rare'] as const;
export type RollRarity = (typeof ROLL_RARITIES)[number];
/** `fallback` is the weapon you hold when you have nothing else (fists); it is never rolled. */
export type WeaponRarity = RollRarity | 'fallback';

const idPattern = /^[a-z][a-z0-9_]*$/;
const nonNegative = z.number().nonnegative();
const positive = z.number().positive();
const fraction = z.number().min(0).max(1);
const degrees = z.number().positive().max(360);

const meleeSchema = z
  .object({
    damage: nonNegative,
    /** Reach from the body centre. */
    rangePx: positive,
    /** Full width of the swing, centred on the aim angle. */
    arcDegrees: degrees,
    knockbackPx: nonNegative,
    stunSeconds: nonNegative,
  })
  .strict();

const projectileSchema = z
  .object({
    /** Damage on a direct hit, and to everyone inside `area` when it has one. */
    damage: nonNegative,
    speedPxPerSecond: positive,
    /** Distance it flies before it lands (and bursts, if it has an area). */
    rangePx: positive,
    /** Collision radius of the projectile itself. */
    radiusPx: positive,
    knockbackPx: nonNegative,
    /** Splash or burst where it lands or hits; null for a single-target projectile. */
    area: z.object({ radiusPx: positive, knockbackPx: nonNegative }).strict().nullable(),
  })
  .strict();

const spraySchema = z
  .object({
    /** Damage per damage tick to everyone in the cone (§7 "3 / tick"). */
    damagePerTick: nonNegative,
    /** Length of one damage tick while spraying. */
    tickSeconds: positive,
    rangePx: positive,
    coneDegrees: degrees,
    /** Push away from the sprayer while inside the cone. */
    pushPxPerSecond: nonNegative,
    /** Speed multiplier put on targets (0.6 = 40% slower) and how long it lasts after the last tick. */
    slow: z.object({ multiplier: fraction, seconds: positive }).strict().nullable(),
    /** Cloud left in the cone that hides what is behind it. */
    visionCloud: z.object({ radiusPx: positive, seconds: positive }).strict().nullable(),
  })
  .strict();

const trapSchema = z
  .object({
    damage: nonNegative,
    lifetimeSeconds: positive,
    triggerRadiusPx: positive,
    /** Time after placing before it can trigger, so it does not go off under the thrower. */
    armSeconds: nonNegative,
    slideSeconds: nonNegative,
    slideSpeedPxPerSecond: nonNegative,
    dropsCarried: z.boolean(),
  })
  .strict();

const chargeSchema = z
  .object({
    damage: nonNegative,
    distanceTiles: positive,
    speedPxPerSecond: positive,
    /** Width of the swept line that gets hit. */
    widthPx: positive,
    knockbackPx: nonNegative,
    knockdownSeconds: nonNegative,
    scattersItems: z.boolean(),
    scatterPx: nonNegative,
  })
  .strict();

const blockSchema = z
  .object({
    /** Melee damage taken while blocking is multiplied by this (0.3 = −70%). */
    meleeDamageMultiplier: fraction,
    moveSpeedMultiplier: fraction,
    reflectsProjectiles: z.boolean(),
  })
  .strict();

const base = {
  id: z.string().regex(idPattern, 'must be snake_case (a-z, 0-9, _), starting with a letter'),
  /** English display name (weapon names are game text, not store brands). */
  name: z.string().trim().min(1),
  /** Frame in the `weapons` atlas (§11.1). Defaults to the id. */
  sprite: z.string().regex(idPattern, 'must be a snake_case frame name').optional(),
  rarity: z.enum([...ROLL_RARITIES, 'fallback']),
  /**
   * Uses until the weapon is spent and you are back to fists; null = unlimited (fists only).
   * Swings, throws, peels or charges for most weapons; seconds of spraying for `spray` weapons.
   */
  uses: positive.nullable(),
  /** Time between two uses. 0 for continuous sprays. */
  cooldownSeconds: nonNegative,
  block: blockSchema.optional(),
};

export const weaponSchema = z.discriminatedUnion('behaviour', [
  z.object({ ...base, behaviour: z.literal('melee'), melee: meleeSchema }).strict(),
  z.object({ ...base, behaviour: z.literal('spray'), spray: spraySchema }).strict(),
  z.object({ ...base, behaviour: z.literal('thrown'), projectile: projectileSchema }).strict(),
  z.object({ ...base, behaviour: z.literal('trap'), trap: trapSchema }).strict(),
  z
    .object({
      ...base,
      behaviour: z.literal('shot_then_melee'),
      /** The first `shotUses` of `uses` fire `shot`; the rest are `melee` swings. */
      shotUses: z.number().int().positive(),
      shot: projectileSchema,
      melee: meleeSchema,
    })
    .strict(),
  z.object({ ...base, behaviour: z.literal('charge'), charge: chargeSchema }).strict(),
]);

export const weaponCatalogueSchema = z
  .object({ weapons: z.array(weaponSchema).min(1) })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    let fallbacks = 0;
    data.weapons.forEach((w, index) => {
      const at = (key: string): (string | number)[] => ['weapons', index, key];
      if (seen.has(w.id))
        ctx.addIssue({ code: 'custom', path: at('id'), message: `duplicate weapon id "${w.id}"` });
      seen.add(w.id);
      if (w.rarity === 'fallback') {
        fallbacks += 1;
        if (w.uses !== null) {
          ctx.addIssue({
            code: 'custom',
            path: at('uses'),
            message: 'the fallback weapon must have unlimited uses (null)',
          });
        }
      } else if (w.uses === null) {
        ctx.addIssue({
          code: 'custom',
          path: at('uses'),
          message: `rolled weapon "${w.id}" needs a number of uses`,
        });
      }
      if (w.uses !== null && w.behaviour !== 'spray' && !Number.isInteger(w.uses)) {
        ctx.addIssue({
          code: 'custom',
          path: at('uses'),
          message: 'uses must be whole (only sprays count seconds)',
        });
      }
      if (w.behaviour === 'shot_then_melee' && w.uses !== null && w.shotUses >= w.uses) {
        ctx.addIssue({
          code: 'custom',
          path: at('shotUses'),
          message: 'shotUses must leave at least one melee use',
        });
      }
    });
    if (fallbacks !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['weapons'],
        message: `needs exactly one fallback weapon, found ${fallbacks}`,
      });
    }
    if (!data.weapons.some((w) => w.rarity !== 'fallback')) {
      ctx.addIssue({
        code: 'custom',
        path: ['weapons'],
        message: 'needs at least one weapon that can be rolled',
      });
    }
  });

type RawWeapon = z.infer<typeof weaponSchema>;
/** A weapon definition, discriminated on `behaviour`. `sprite` is always filled in. Frozen at load. */
export type WeaponDef = Readonly<RawWeapon> & { readonly sprite: string };
export type MeleeStats = z.infer<typeof meleeSchema>;
export type ProjectileStats = z.infer<typeof projectileSchema>;
export type SprayStats = z.infer<typeof spraySchema>;
export type TrapStats = z.infer<typeof trapSchema>;
export type ChargeStats = z.infer<typeof chargeSchema>;
export type BlockStats = z.infer<typeof blockSchema>;
/** The weapon definition for one behaviour type, e.g. `WeaponOf<'thrown'>`. */
export type WeaponOf<B extends WeaponBehaviour> = Extract<WeaponDef, { behaviour: B }>;

export interface WeaponCatalogue {
  /** Every weapon, in file order. */
  readonly weapons: readonly WeaponDef[];
  /** The weapon you hold with nothing else (fists): start, after KO, when a weapon is spent. */
  readonly fallback: WeaponDef;
  /** Weapons a pickup can roll, in file order. */
  readonly rollable: readonly WeaponDef[];
  get(id: string): WeaponDef | undefined;
  /** Throws for an unknown id. */
  require(id: string): WeaponDef;
  /** Rollable weapons of one rarity, in file order. */
  ofRarity(rarity: RollRarity): readonly WeaponDef[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validates raw weapon data and returns a frozen catalogue. Throws `ConfigError` on bad data (§15.4). */
export function loadWeaponCatalogue(raw: unknown, source = 'weapons.json'): WeaponCatalogue {
  const result = weaponCatalogueSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(source, formatIssues(result.error));

  const weapons = deepFreeze(
    result.data.weapons.map((w) => ({ ...w, sprite: w.sprite ?? w.id })),
  ) as readonly WeaponDef[];
  const byId = new Map(weapons.map((w) => [w.id, w]));
  // The schema guarantees exactly one fallback.
  const fallback = weapons.find((w) => w.rarity === 'fallback') as WeaponDef;
  const rollable = Object.freeze(weapons.filter((w) => w.rarity !== 'fallback'));
  const byRarity = new Map<RollRarity, readonly WeaponDef[]>(
    ROLL_RARITIES.map((r) => [r, Object.freeze(rollable.filter((w) => w.rarity === r))]),
  );
  return Object.freeze({
    weapons,
    fallback,
    rollable,
    get: (id: string) => byId.get(id),
    require: (id: string) => {
      const w = byId.get(id);
      if (!w) throw new RangeError(`Unknown weapon id "${id}" in ${source}`);
      return w;
    },
    ofRarity: (rarity: RollRarity) => byRarity.get(rarity) ?? [],
  });
}

let cached: WeaponCatalogue | undefined;

/** The validated, bundled weapon catalogue (data/weapons.json). */
export function getWeaponCatalogue(): WeaponCatalogue {
  cached ??= loadWeaponCatalogue(weaponsJson, 'weapons.json');
  return cached;
}

/** The attack a weapon makes: its behaviour, except that shot_then_melee is `shot` or `melee`. */
export type AttackMode = Exclude<WeaponBehaviour, 'shot_then_melee'> | 'shot';

/** Which attack a held weapon makes with `usesLeft` uses remaining. Only shot_then_melee changes over its life. */
export function attackMode(weapon: WeaponDef, usesLeft: number | null): AttackMode {
  if (weapon.behaviour !== 'shot_then_melee') return weapon.behaviour;
  const meleeUses = (weapon.uses ?? 0) - weapon.shotUses;
  return usesLeft !== null && usesLeft > meleeUses ? 'shot' : 'melee';
}
