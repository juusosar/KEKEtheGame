// Checks the placeholder art against the §11.1 sprite spec, and that the committed assets are
// exactly what tools/gen-placeholder-art.ts produces (deterministic, not stale).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AtlasJson } from './art/atlas';
import { ASSETS_DIR, generateAll, type AssetManifest } from './art/generate';
import { decodePng } from './art/png';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = generateAll();

function file(path: string): Buffer {
  const buf = generated.get(path);
  if (!buf) throw new Error(`not generated: ${path}`);
  return buf;
}
const atlas = (key: string): AtlasJson =>
  JSON.parse(file(`${ASSETS_DIR}/${key}.json`).toString()) as AtlasJson;
const manifest = JSON.parse(file(`${ASSETS_DIR}/manifest.json`).toString()) as AssetManifest;

// ── The spec, written out independently of the generator (§7, §8, §10, §11.1) ──
const DIRS = ['down', 'up', 'left', 'right'];
const CHARACTER_ANIMS: Record<string, number> = { idle: 2, walk: 4, attack: 2, hit: 1, ko: 1 };
const CHARACTER_SHEETS = [
  'body',
  'hat_chef',
  'hat_cap',
  'hat_beanie',
  'hat_hairnet',
  'hat_hardhat',
  'stocker',
  'security',
  'butcher',
  'customer',
];
const WEAPONS = [
  'fists',
  'baguette',
  'frozen_salmon',
  'rolling_pin',
  'ketchup_bottle',
  'egg_carton',
  'soda_bottle',
  'cast_iron_pan',
  'banana_peels',
  'fire_extinguisher',
  'champagne_bottle',
  'pallet_jack',
];
const NORMAL_ITEMS = [
  'coffee_juhla_mokka',
  'flour_myllyn_paras',
  'pasta_barilla',
  'ketchup_felix',
  'tomato_crush',
  'taco_spice',
  'oil_rapeseed',
  'chocolate_fazer',
  'cola',
  'jaffa',
  'novelle',
  'pommac',
  'kotikalja',
  'lapin_kulta_pure',
  'butter_valio',
  'milk_valio',
  'cheese_oltermanni',
  'eggs',
  'cream_whip',
  'cheese_polar',
  'mince_atria',
  'sausage_sininen_lenkki',
  'salmon_fillet',
  'chicken_breast',
  'bacon_atria',
  'fries_frozen',
  'veg_mix_apetit',
  'ice_cream_pingviini',
  'fish_fingers_apetit',
  'blueberries_frozen',
];
const JOKE_ITEMS = [
  'kurkkumopo',
  'palju',
  'kiuas',
  'flamingo',
  'karaoke',
  'moose_head',
  'rubber_boots',
  'christmas_ham',
  'snowblower',
  'garden_gnome',
];
const FX = [
  'hit_spark',
  'ketchup_splat',
  'egg_splat',
  'fizz_burst',
  'extinguisher_cloud',
  'banana_slip',
  'ko_stars',
];

function expectFrames(key: string, expected: Record<string, [number, number]>): void {
  const json = atlas(key);
  expect(Object.keys(json.frames).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, [w, h]] of Object.entries(expected)) {
    const f = json.frames[name];
    expect(f?.frame.w, `${key}:${name} width`).toBe(w);
    expect(f?.frame.h, `${key}:${name} height`).toBe(h);
    expect(f?.sourceSize).toEqual({ w, h });
  }
}

const sized = (names: string[], w: number, h: number): Record<string, [number, number]> =>
  Object.fromEntries(names.map((n) => [n, [w, h]]));

describe('placeholder art matches the §11.1 sprite spec', () => {
  const characterFrames = Object.entries(CHARACTER_ANIMS).flatMap(([anim, n]) =>
    DIRS.flatMap((dir) => Array.from({ length: n }, (_, i) => `${anim}_${dir}_${i}`)),
  );

  it.each(CHARACTER_SHEETS)('%s: 32×32, 4 directions, idle 2 / walk 4 / attack 2 / hit 1 / KO 1', (key) => {
    expect(characterFrames).toHaveLength(40);
    expectFrames(key, sized(characterFrames, 32, 32));
  });

  it('weapons: one 32×32 frame per weapon', () => {
    expectFrames('weapons', sized(WEAPONS, 32, 32));
  });

  it('items: 30 normal items at 24×24 and 10 joke items at 32×32', () => {
    expectFrames('items', { ...sized(NORMAL_ITEMS, 24, 24), ...sized(JOKE_ITEMS, 32, 32) });
  });

  it('order box: 32×32', () => {
    expectFrames('order_box', { order_box: [32, 32] });
  });

  it('forklift: 64×32, 4 directions, 2-frame warning light', () => {
    expectFrames(
      'forklift',
      sized(
        DIRS.flatMap((d) => [`drive_${d}_0`, `drive_${d}_1`]),
        64,
        32,
      ),
    );
  });

  it('van: 64×96, one per van slot (16)', () => {
    expectFrames(
      'van',
      sized(
        Array.from({ length: 16 }, (_, i) => `slot_${i + 1}`),
        64,
        96,
      ),
    );
  });

  it('fx: 32×32 each', () => {
    expectFrames('fx', sized(FX, 32, 32));
  });

  it('tileset: kespro_tiles.png is a grid of 32×32 tiles', () => {
    const png = decodePng(file(`${ASSETS_DIR}/kespro_tiles.png`));
    expect(png.width % 32).toBe(0);
    expect(png.height % 32).toBe(0);
    const tsj = JSON.parse(file('maps/kespro_tiles.tsj').toString()) as Record<string, unknown>;
    expect(tsj).toMatchObject({
      tilewidth: 32,
      tileheight: 32,
      imagewidth: png.width,
      imageheight: png.height,
    });
  });

  it('every atlas is JSON-hash with frames inside the texture and not overlapping', () => {
    for (const { key, texture } of manifest.atlases) {
      const json = atlas(key);
      const png = decodePng(file(`${ASSETS_DIR}/${texture}`));
      expect(json.meta.image).toBe(texture);
      expect(json.meta.size).toEqual({ w: png.width, h: png.height });
      const rects = Object.values(json.frames).map((f) => f.frame);
      for (const r of rects) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= png.width && r.y + r.h <= png.height).toBe(true);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (!a || !b) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${key}: frames ${i} and ${j} overlap`).toBe(false);
        }
      }
    }
  });

  it('animation keys are <sheet>/<anim>_<dir> and point at existing frames', () => {
    const keys = manifest.animations.map((a) => a.key);
    expect(keys).toContain('body/walk_down');
    expect(keys).toContain('hat_chef/idle_left');
    expect(keys).toContain('forklift/drive_up');
    expect(new Set(keys).size).toBe(keys.length);
    for (const anim of manifest.animations) {
      expect(anim.key).toMatch(new RegExp(`^${anim.atlas}/[a-z]+_(down|up|left|right)$`));
      const frames = atlas(anim.atlas).frames;
      for (const f of anim.frames) expect(frames[f], `${anim.key} → ${f}`).toBeDefined();
    }
    for (const key of CHARACTER_SHEETS) {
      for (const [anim, n] of Object.entries(CHARACTER_ANIMS)) {
        for (const dir of DIRS) {
          expect(manifest.animations.find((a) => a.key === `${key}/${anim}_${dir}`)?.frames).toHaveLength(n);
        }
      }
    }
  });
});

describe('gen-placeholder-art output', () => {
  it('is deterministic', () => {
    const again = generateAll();
    expect([...again.keys()]).toEqual([...generated.keys()]);
    for (const [path, buf] of generated) expect(again.get(path)?.equals(buf), path).toBe(true);
  });

  it('matches the committed files (run `npm run gen:art` after changing the generator)', () => {
    for (const [path, buf] of generated) {
      const committed = readFileSync(resolve(repoRoot, path));
      if (path.endsWith('.png')) {
        // Compare pixels, not bytes: zlib builds may compress the same pixels differently.
        const a = decodePng(committed);
        const b = decodePng(buf);
        expect([a.width, a.height], path).toEqual([b.width, b.height]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data)), `${path} pixels`).toBe(true);
      } else {
        expect(committed.toString(), path).toBe(buf.toString());
      }
    }
  });
});
