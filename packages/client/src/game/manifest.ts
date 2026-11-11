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
