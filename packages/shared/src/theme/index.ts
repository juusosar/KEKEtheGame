import { kesproTheme } from './kespro';
import { prismaTheme } from './prisma';
import type { MapTheme, ThemeId } from './types';

export type { HexColor, MapTheme, ThemeAssets, ThemeBrand, ThemeColors, ThemeId } from './types';
export { kesproTheme } from './kespro';
export { prismaTheme } from './prisma';
export { findBrandTerms, type BrandHit } from './brandGuard';

/** Every map theme, keyed by id. */
export const themes: Readonly<Record<ThemeId, MapTheme>> = {
  kespro: kesproTheme,
  prisma: prismaTheme,
};

/** The theme used when nothing else is chosen (the MVP map). */
export const defaultThemeId: ThemeId = 'kespro';

export function getTheme(id: ThemeId): MapTheme {
  return themes[id];
}

/** All guarded brand words across every theme, de-duplicated. */
export function allGuardedTerms(): string[] {
  return [...new Set(Object.values(themes).flatMap((theme) => theme.brand.guardedTerms))];
}
