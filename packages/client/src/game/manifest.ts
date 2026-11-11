// Shape of public/assets/manifest.json, written by tools/gen-placeholder-art.ts (M1-1).
export interface AssetManifest {
  atlases: { key: string; texture: string; atlas: string }[];
  animations: { key: string; atlas: string; frames: string[]; frameRate: number; repeat: number }[];
  tilesets: { key: string; image: string; tileWidth: number; tileHeight: number }[];
  /**
   * Theme id → its tileset key and the atlas key of each theme-coloured sheet (`van`, `order_box`,
   * `cart`, `gate`). The default theme's sheets keep the bare names; others are `<sheet>_<id>`.
   */
  themes: Record<string, { tileset: string; atlases: Record<string, string> }>;
}

/** The theme-coloured sheets every theme has (`manifest.themes[id].atlases`). */
export type ThemeSheet = 'van' | 'order_box' | 'cart' | 'gate';

/**
 * Atlas key of a theme's sheet (P1-5): e.g. the second map's green van. Falls back to the bare sheet
 * name (the default theme's) when the manifest has no entry for the theme.
 */
export function themeAtlasKey(
  manifest: Partial<Pick<AssetManifest, 'themes'>> | undefined,
  themeId: string,
  sheet: ThemeSheet,
): string {
  return manifest?.themes?.[themeId]?.atlases[sheet] ?? sheet;
}
