// Theme values the placeholder art needs, read from the map theme files (§14), so brand
// colours, logo and tileset names stay in packages/shared/src/theme/ only.
import { defaultThemeId, themes, type MapTheme } from '../../packages/shared/src/theme';

export interface ArtTheme {
  id: string;
  /** Tileset image file name, e.g. `<id>_tiles.png`. */
  tileset: string;
  /** Single letter painted as the "logo" on order boxes, signs and vans. */
  logoLetter: string;
  primary: string;
  dark: string;
  concrete: string;
}

function toArtTheme(theme: MapTheme): ArtTheme {
  return {
    id: theme.id,
    tileset: theme.assets.tileset,
    logoLetter: theme.brand.storeName.charAt(0).toUpperCase(),
    primary: theme.colors.primary,
    dark: theme.colors.secondary,
    concrete: theme.colors.floor,
  };
}

/** Themes whose maps exist (`available`), default theme first. */
export const ART_THEMES: readonly ArtTheme[] = Object.values(themes)
  .filter((t) => t.available)
  .sort((a, b) => Number(b.id === defaultThemeId) - Number(a.id === defaultThemeId))
  .map(toArtTheme);
