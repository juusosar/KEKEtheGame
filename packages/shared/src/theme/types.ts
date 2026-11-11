// Shape every map theme file fills in (§14). Brand names, colours and asset references live only in the
// theme files of this folder; the rest of the codebase reads them through this interface.

/** A colour as a `#RRGGBB` hex string. */
export type HexColor = `#${string}`;

export type ThemeId = 'kespro' | 'prisma';

export interface ThemeBrand {
  /** Store brand shown to players, e.g. on the order box and the title screen. */
  storeName: string;
  /** Longer form for flavour text, e.g. "Kespro wholesale store". */
  storeDescription: string;
  /**
   * Every brand word this theme introduces. The brand guard test fails when any of them appears in a
   * source file outside `packages/shared/src/theme/`. Matched case-sensitively as whole words.
   */
  guardedTerms: readonly string[];
}

export interface ThemeColors {
  /** Signature brand colour: vans, signage, order box print, UI accents. */
  primary: HexColor;
  /** Secondary tone used with the primary (text on signs, UI panels). */
  secondary: HexColor;
  /** Floor / neutral tone of the map. */
  floor: HexColor;
  /** Sprite outline colour (§11: bold 1–2 px dark outlines). */
  outline: HexColor;
}

export interface ThemeAssets {
  /** Tiled map file under `maps/`. */
  map: string;
  /** Tileset image under `client/public/assets/`. */
  tileset: string;
  /** Item catalogue under `packages/shared/src/data/`. */
  itemCatalogue: string;
  /** Looping music track under `client/public/assets/`, a WAV made by `npm run gen:sfx` (§12). */
  music: string;
}

export interface MapTheme {
  /** Stable, lower-case id. Used in file names, asset keys and room settings, never shown to players. */
  id: ThemeId;
  /** False while the map is not built yet (Prisma until phase 2). */
  available: boolean;
  brand: ThemeBrand;
  colors: ThemeColors;
  assets: ThemeAssets;
}
