// Loads everything listed in public/assets/manifest.json and creates its animations. Shared by every
// scene that draws sprites (Profile preview, Game); keys already loaded are skipped.
import type Phaser from 'phaser';
import type { AssetManifest } from './manifest';

export const MANIFEST_KEY = 'manifest';

/** Call from preload(). */
export function preloadManifestAssets(scene: Phaser.Scene): void {
  scene.load.setPath('assets/');
  const queueAll = (data: AssetManifest): void => {
    for (const atlas of data.atlases) {
      if (!scene.textures.exists(atlas.key)) scene.load.atlas(atlas.key, atlas.texture, atlas.atlas);
    }
    for (const tileset of data.tilesets) {
      if (!scene.textures.exists(tileset.key)) scene.load.image(tileset.key, tileset.image);
    }
  };
  if (scene.cache.json.exists(MANIFEST_KEY)) {
    queueAll(scene.cache.json.get(MANIFEST_KEY) as AssetManifest);
    return;
  }
  scene.load.json(MANIFEST_KEY, 'manifest.json');
  // Everything else is listed in the manifest, so queue it once the manifest itself has arrived.
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (_key: string, _type: string, data: AssetManifest) =>
    queueAll(data),
  );
}

/** Call from create(): registers the manifest's animations once per game. */
export function createManifestAnimations(scene: Phaser.Scene): AssetManifest {
  const manifest = scene.cache.json.get(MANIFEST_KEY) as AssetManifest;
  for (const anim of manifest.animations) {
    if (scene.anims.exists(anim.key)) continue;
    scene.anims.create({
      key: anim.key,
      frames: anim.frames.map((frame) => ({ key: anim.atlas, frame })),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
    });
  }
  return manifest;
}
