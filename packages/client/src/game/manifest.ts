// Shape of public/assets/manifest.json, written by tools/gen-placeholder-art.ts (M1-1).
export interface AssetManifest {
  atlases: { key: string; texture: string; atlas: string }[];
  animations: { key: string; atlas: string; frames: string[]; frameRate: number; repeat: number }[];
  tilesets: { key: string; image: string; tileWidth: number; tileHeight: number }[];
}
