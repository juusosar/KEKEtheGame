// Non-character sprites (§11.1): held weapons, items, order box, forklift, vans, FX.
import { Canvas, OUTLINE, hex, textWidth, type Rgba } from './canvas';
import type { Frame } from './atlas';
import { DIRECTIONS } from './characters';
import type { ArtTheme } from './theme';

const WHITE = hex('#ffffff');
const INK = hex('#1a1a1a');

/** Lighter / darker variant of a colour, for the one shadow tone per material (§11). */
function shade(c: Rgba, f: number): Rgba {
  const t = f >= 0 ? 255 : 0;
  const k = Math.abs(f);
  return [
    Math.round(c[0] + (t - c[0]) * k),
    Math.round(c[1] + (t - c[1]) * k),
    Math.round(c[2] + (t - c[2]) * k),
    c[3],
  ];
}

function star(c: Canvas, cx: number, cy: number, r: number, col: Rgba): void {
  c.line(cx - r, cy, cx + r, cy, col).line(cx, cy - r, cx, cy + r, col);
  const d = Math.max(1, Math.round(r * 0.5));
  c.line(cx - d, cy - d, cx + d, cy + d, col).line(cx - d, cy + d, cx + d, cy - d, col);
}

// ── Items ─────────────────────────────────────────────────────────────────────

type ItemShape = 'bag' | 'box' | 'bottle' | 'carton' | 'tub' | 'block' | 'pack' | 'sausage' | 'fish' | 'long';

interface ItemLook {
  id: string;
  shape: ItemShape;
  color: string;
  label: string;
}

/** §10 catalogue ids (normal items), with a placeholder look each. */
export const NORMAL_ITEMS: readonly ItemLook[] = [
  { id: 'coffee_juhla_mokka', shape: 'bag', color: '#c0392b', label: 'KAF' },
  { id: 'flour_myllyn_paras', shape: 'bag', color: '#f3efe0', label: 'JAU' },
  { id: 'pasta_barilla', shape: 'box', color: '#2a5db0', label: 'SPA' },
  { id: 'ketchup_felix', shape: 'bottle', color: '#d22d2d', label: 'KET' },
  { id: 'tomato_crush', shape: 'tub', color: '#c83a2a', label: 'TOM' },
  { id: 'taco_spice', shape: 'bag', color: '#e6a23c', label: 'TAC' },
  { id: 'oil_rapeseed', shape: 'bottle', color: '#f2d04a', label: 'OIL' },
  { id: 'chocolate_fazer', shape: 'box', color: '#1e3f9a', label: 'SUK' },
  { id: 'cola', shape: 'bottle', color: '#b3121a', label: 'COL' },
  { id: 'jaffa', shape: 'bottle', color: '#f28c28', label: 'JAF' },
  { id: 'novelle', shape: 'bottle', color: '#7ec8e3', label: 'NOV' },
  { id: 'pommac', shape: 'bottle', color: '#e5c07b', label: 'POM' },
  { id: 'kotikalja', shape: 'bottle', color: '#5b3a1e', label: 'KAL' },
  { id: 'lapin_kulta_pure', shape: 'bottle', color: '#e8d27a', label: '0%' },
  { id: 'butter_valio', shape: 'tub', color: '#f6e27a', label: 'VOI' },
  { id: 'milk_valio', shape: 'carton', color: '#3d7fd9', label: 'MAI' },
  { id: 'cheese_oltermanni', shape: 'block', color: '#f2c14e', label: 'OLT' },
  { id: 'eggs', shape: 'box', color: '#e9d8b5', label: 'MUN' },
  { id: 'cream_whip', shape: 'carton', color: '#9fd3f0', label: 'KER' },
  { id: 'cheese_polar', shape: 'block', color: '#f5d76e', label: 'POL' },
  { id: 'mince_atria', shape: 'pack', color: '#b23a48', label: 'LIH' },
  { id: 'sausage_sininen_lenkki', shape: 'sausage', color: '#2c5aa0', label: 'LEN' },
  { id: 'salmon_fillet', shape: 'fish', color: '#f08a6c', label: 'LOH' },
  { id: 'chicken_breast', shape: 'pack', color: '#f4c7b0', label: 'BRO' },
  { id: 'bacon_atria', shape: 'pack', color: '#d9534f', label: 'PEK' },
  { id: 'fries_frozen', shape: 'bag', color: '#f5c542', label: 'RAN' },
  { id: 'veg_mix_apetit', shape: 'bag', color: '#4caf50', label: 'HMP' },
  { id: 'ice_cream_pingviini', shape: 'tub', color: '#f7f3e3', label: 'JAA' },
  { id: 'fish_fingers_apetit', shape: 'box', color: '#ff9f1c', label: 'PUI' },
  { id: 'blueberries_frozen', shape: 'bag', color: '#3b3b98', label: 'MUS' },
];

/** §10.1 joke items: 32 × 32 with a sparkle. */
export const JOKE_ITEMS: readonly ItemLook[] = [
  { id: 'kurkkumopo', shape: 'long', color: '#3fa34d', label: 'MOPO' },
  { id: 'palju', shape: 'tub', color: '#8b5a2b', label: 'PALJ' },
  { id: 'kiuas', shape: 'box', color: '#6d6d6d', label: 'KIUA' },
  { id: 'flamingo', shape: 'bottle', color: '#ff7eb9', label: 'FLAM' },
  { id: 'karaoke', shape: 'box', color: '#2a2a6e', label: 'KARA' },
  { id: 'moose_head', shape: 'fish', color: '#7b4b2a', label: 'HIRV' },
  { id: 'rubber_boots', shape: 'carton', color: '#2f6b2f', label: 'BOOT' },
  { id: 'christmas_ham', shape: 'long', color: '#f2a5a0', label: 'HAM' },
  { id: 'snowblower', shape: 'box', color: '#d63031', label: 'LUMI' },
  { id: 'garden_gnome', shape: 'bottle', color: '#c0392b', label: 'TONT' },
];

export const ITEM_SIZE = 24;
export const JOKE_ITEM_SIZE = 32;

/** Draws `shape` filling the box (x0, y0)–(x1, y1) inclusive, returns the label's centre y. */
function drawItemShape(
  c: Canvas,
  shape: ItemShape,
  col: Rgba,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  const dark = shade(col, -0.25);
  switch (shape) {
    case 'bag':
      c.rect(x0 + 1, y0 + 2, w - 2, h - 2, col);
      c.rect(x0 + 2, y0, w - 4, 2, dark);
      c.rect(x0 + 1, y1 - 1, w - 2, 2, dark);
      return cy + 1;
    case 'box':
      c.rect(x0, y0 + 2, w, h - 2, col);
      c.rect(x0 + 2, y0, w - 2, 2, shade(col, 0.3));
      c.rect(x1 - 1, y0 + 2, 2, h - 2, dark);
      return cy + 1;
    case 'bottle': {
      const bw = Math.round(w * 0.55);
      const bx = Math.round(cx - bw / 2);
      c.rect(bx, y0 + Math.round(h * 0.3), bw, h - Math.round(h * 0.3), col);
      c.rect(Math.round(cx - 2), y0 + 2, 4, Math.round(h * 0.3), col);
      c.rect(Math.round(cx - 2), y0, 4, 2, dark);
      c.rect(bx, y1 - 1, bw, 2, dark);
      return cy + Math.round(h * 0.15);
    }
    case 'carton': {
      c.rect(x0 + 2, y0 + 5, w - 4, h - 5, col);
      for (let k = 0; k < 5; k++) c.rect(x0 + 2 + k, y0 + 5 - k, w - 4 - 2 * k, 1, dark);
      return cy + 2;
    }
    case 'tub':
      c.rect(x0, y0 + 4, w, h - 6, col);
      c.ellipse(cx, y0 + 4, w / 2, 3, shade(col, 0.3));
      c.ellipse(cx, y1 - 2, w / 2, 2.5, col);
      return cy + 1;
    case 'block':
      c.rect(x0, y0 + 4, w, h - 4, col);
      c.rect(x0 + 3, y0, w - 3, 4, shade(col, 0.3));
      c.ellipse(x0 + 4, y1 - 3, 1.5, 1.5, dark).ellipse(x1 - 5, y0 + 8, 1.5, 1.5, dark);
      return cy + 1;
    case 'pack':
      c.rect(x0, y0 + 3, w, h - 6, hex('#e8e8e8'));
      c.rect(x0 + 2, y0 + 5, w - 4, h - 10, col);
      return cy;
    case 'sausage':
      c.ellipse(cx, cy, w / 2, h / 3, col);
      c.rect(x0, Math.round(cy) - 1, 2, 2, dark).rect(x1 - 1, Math.round(cy) - 1, 2, 2, dark);
      return cy;
    case 'fish':
      c.ellipse(cx - w * 0.1, cy, w * 0.4, h / 3, col);
      for (let k = 0; k < Math.round(w * 0.25); k++) {
        c.rect(x1 - k, Math.round(cy - k * 0.8), 1, Math.round(k * 1.6) + 1, dark);
      }
      c.rect(Math.round(x0 + w * 0.2), Math.round(cy - 2), 2, 2, INK);
      return cy + 1;
    case 'long':
      c.ellipse(cx, cy, w / 2, h / 3.2, col);
      c.ellipse(cx, cy - h / 8, w / 2.4, h / 10, shade(col, 0.3));
      return cy;
  }
}

function itemFrame(look: ItemLook, size: number, joke: boolean): Frame {
  const c = new Canvas(size, size);
  const col = hex(look.color);
  const inset = joke ? 4 : 2;
  const labelCy = drawItemShape(c, look.shape, col, inset, inset, size - 1 - inset, size - 1 - inset);
  const lw = textWidth(look.label);
  // Label on a small plate so it reads on every colour.
  const ly = Math.round(labelCy - 2.5);
  c.rect(Math.round(size / 2 - lw / 2) - 1, ly - 1, lw + 2, 7, WHITE);
  c.textCentered(look.label, size / 2, ly, INK);
  c.outline(OUTLINE);
  if (joke) {
    // §10.1 sparkle so everyone notices.
    star(c, size - 5, 4, 3, hex('#fff27a'));
    c.set(size - 5, 4, WHITE);
    star(c, 4, size - 6, 2, hex('#fff27a'));
  }
  return { name: look.id, canvas: c };
}

export function itemFrames(): Frame[] {
  return [
    ...NORMAL_ITEMS.map((look) => itemFrame(look, ITEM_SIZE, false)),
    ...JOKE_ITEMS.map((look) => itemFrame(look, JOKE_ITEM_SIZE, true)),
  ];
}

// ── Held weapons (one frame each, pointing right = aim angle 0) ───────────────

export const WEAPONS = [
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
] as const;

function horizontalBottle(c: Canvas, body: Rgba, neck: Rgba, x0: number, len: number, r: number): void {
  c.rect(x0, 16 - r, len, r * 2, body);
  c.rect(x0 + len, 14, 6, 4, body);
  c.rect(x0 + len + 6, 14, 2, 4, neck);
}

function drawWeapon(c: Canvas, id: (typeof WEAPONS)[number]): void {
  switch (id) {
    case 'fists':
      c.ellipse(24, 16, 4.5, 4, hex('#e8e8e8'));
      c.rect(22, 13, 1, 6, hex('#bdbdbd'));
      break;
    case 'baguette':
      c.ellipse(16, 16, 13, 3.5, hex('#d9a35b'));
      for (let x = 8; x <= 24; x += 5) c.line(x, 15, x + 2, 17, hex('#f3d39a'));
      break;
    case 'frozen_salmon':
      c.ellipse(15, 16, 10, 4.5, hex('#e9967a'));
      c.rect(4, 13, 3, 7, hex('#c4705a'));
      c.ellipse(15, 15, 8, 1.5, hex('#d6f0ff', 200));
      c.rect(22, 15, 2, 2, INK);
      break;
    case 'rolling_pin':
      c.rect(9, 13, 14, 6, hex('#e0b77a'));
      c.rect(4, 15, 5, 2, hex('#a5743c')).rect(23, 15, 5, 2, hex('#a5743c'));
      break;
    case 'ketchup_bottle':
      horizontalBottle(c, hex('#d22d2d'), WHITE, 6, 14, 4);
      break;
    case 'egg_carton':
      c.rect(6, 11, 20, 10, hex('#b9a58a'));
      for (let x = 8; x < 26; x += 6) c.ellipse(x + 2, 14, 2, 1.5, hex('#f5f0e6'));
      break;
    case 'soda_bottle':
      horizontalBottle(c, hex('#4caf50'), hex('#d0d0d0'), 6, 14, 4);
      c.rect(9, 15, 8, 2, hex('#e8f5e9'));
      break;
    case 'cast_iron_pan':
      c.rect(3, 15, 10, 3, hex('#4a4a4a'));
      c.ellipse(21, 16, 8, 8, hex('#2e2e2e'));
      c.ellipse(21, 16, 6, 6, hex('#404040'));
      break;
    case 'banana_peels':
      c.ellipse(16, 18, 6, 4, hex('#f4d03f'));
      c.line(11, 17, 6, 11, hex('#f4d03f'), 2)
        .line(16, 15, 16, 8, hex('#f4d03f'), 2)
        .line(21, 17, 26, 11, hex('#f4d03f'), 2);
      break;
    case 'fire_extinguisher':
      c.rect(5, 12, 16, 9, hex('#d63031'));
      c.rect(21, 14, 3, 5, INK);
      c.line(24, 16, 28, 13, INK, 2);
      c.rect(9, 14, 6, 3, WHITE);
      break;
    case 'champagne_bottle':
      horizontalBottle(c, hex('#1e5631'), hex('#d4af37'), 5, 15, 4);
      c.rect(20, 13, 6, 6, hex('#d4af37'));
      break;
    case 'pallet_jack':
      c.rect(3, 9, 3, 14, hex('#555555'));
      c.rect(6, 14, 4, 4, hex('#d63031'));
      c.rect(10, 11, 18, 3, hex('#8a8a8a')).rect(10, 18, 18, 3, hex('#8a8a8a'));
      break;
  }
}

export function weaponFrames(): Frame[] {
  return WEAPONS.map((id) => {
    const c = new Canvas(32, 32);
    drawWeapon(c, id);
    c.outline(OUTLINE);
    return { name: id, canvas: c };
  });
}

// ── Order box ─────────────────────────────────────────────────────────────────

export function orderBoxFrames(theme: ArtTheme): Frame[] {
  const c = new Canvas(32, 32);
  const card = hex('#c69c6d');
  c.rect(4, 8, 24, 20, card);
  c.rect(4, 5, 24, 3, shade(card, 0.25));
  c.rect(25, 8, 3, 20, shade(card, -0.2));
  c.rect(14, 5, 4, 23, hex('#e6d3b3')); // tape
  c.rect(7, 13, 7, 9, hex(theme.primary));
  c.textCentered(theme.logoLetter, 10.5, 15, WHITE);
  c.outline(OUTLINE);
  return [{ name: 'order_box', canvas: c }];
}

// ── Forklift (64 × 32, 4 directions, 2-frame warning light) ───────────────────

export function forkliftFrames(): Frame[] {
  const frames: Frame[] = [];
  const body = hex('#f2b705');
  const bodyDark = shade(body, -0.25);
  const steel = hex('#7f8c8d');
  for (const dir of DIRECTIONS) {
    for (let i = 0; i < 2; i++) {
      const c = new Canvas(64, 32);
      if (dir === 'left' || dir === 'right') {
        const s = dir === 'right' ? 1 : -1;
        const m = (x: number, w: number): number => (s > 0 ? x : 64 - x - w);
        const mx = (x: number): number => (s > 0 ? x : 64 - x);
        c.rect(m(8, 30), 8, 30, 18, body);
        c.rect(m(8, 8), 8, 8, 18, bodyDark); // counterweight
        c.rect(m(20, 12), 10, 12, 12, hex('#34495e')); // cab
        c.rect(m(38, 3), 4, 3, 24, steel); // mast
        c.rect(m(41, 18), 9, 18, 3, steel).rect(m(41, 18), 20, 18, 3, steel); // forks
        c.ellipse(mx(14), 27, 3, 3, INK).ellipse(mx(32), 27, 3, 3, INK);
      } else {
        c.rect(18, 6, 28, 22, body);
        c.rect(24, 9, 16, 12, hex('#34495e'));
        if (dir === 'down') {
          c.rect(16, 4, 32, 3, steel); // mast seen from the front
          c.rect(22, 26, 4, 4, steel).rect(38, 26, 4, 4, steel); // fork tips
        } else {
          c.rect(18, 22, 28, 6, bodyDark); // counterweight seen from behind
        }
        c.rect(15, 18, 3, 8, INK).rect(46, 18, 3, 8, INK);
      }
      c.outline(OUTLINE);
      // Warning light on the roof: on in frame 0, off in frame 1.
      const lx = dir === 'left' ? 64 - 26 - 2 : dir === 'right' ? 26 : 31;
      c.rect(lx, 2, 3, 3, i === 0 ? hex('#ff9f1a') : hex('#7a4a10'));
      if (i === 0) c.set(lx - 1, 3, hex('#ffd27a')).set(lx + 3, 3, hex('#ffd27a'));
      frames.push({ name: `drive_${dir}_${i}`, canvas: c });
    }
  }
  return frames;
}

// ── Vans (64 × 96, theme colour, slot number painted on) ──────────────────────

/** §9.1: 16 van slots on the loading dock. */
export const VAN_SLOTS = 16;

export function vanFrames(theme: ArtTheme): Frame[] {
  const frames: Frame[] = [];
  const body = hex(theme.primary);
  for (let slot = 1; slot <= VAN_SLOTS; slot++) {
    const c = new Canvas(64, 96);
    c.rect(6, 4, 52, 88, body);
    c.rect(10, 8, 44, 14, hex('#2c3e50')); // windscreen
    c.rect(10, 26, 44, 60, shade(body, 0.2)); // roof
    c.rect(6, 4, 52, 3, shade(body, -0.25));
    c.rect(2, 16, 4, 6, INK).rect(58, 16, 4, 6, INK); // mirrors
    c.rect(18, 32, 28, 24, WHITE);
    c.textCentered(String(slot), 32, 37, INK, 3);
    c.textCentered(theme.logoLetter, 32, 66, WHITE, 2);
    c.outline(OUTLINE);
    frames.push({ name: `slot_${slot}`, canvas: c });
  }
  return frames;
}

// ── FX ────────────────────────────────────────────────────────────────────────

export const FX = [
  'hit_spark',
  'ketchup_splat',
  'egg_splat',
  'fizz_burst',
  'extinguisher_cloud',
  'banana_slip',
  'ko_stars',
] as const;

export function fxFrames(): Frame[] {
  return FX.map((id) => {
    const c = new Canvas(32, 32);
    let outline = true;
    switch (id) {
      case 'hit_spark':
        star(c, 16, 16, 11, hex('#ffe066'));
        star(c, 16, 16, 6, WHITE);
        break;
      case 'ketchup_splat':
        c.ellipse(16, 17, 9, 7, hex('#c0392b'));
        c.ellipse(6, 9, 2.5, 2.5, hex('#c0392b'))
          .ellipse(26, 25, 2, 2, hex('#c0392b'))
          .ellipse(25, 8, 2, 2, hex('#c0392b'));
        break;
      case 'egg_splat':
        c.ellipse(16, 16, 11, 8, hex('#fdfdf5'));
        c.ellipse(15, 15, 4, 4, hex('#f5b70a'));
        break;
      case 'fizz_burst':
        for (const [x, y, r] of [
          [16, 16, 5],
          [7, 9, 3],
          [25, 8, 3],
          [8, 24, 2.5],
          [25, 23, 3.5],
          [16, 5, 2],
        ] as const) {
          c.ellipse(x, y, r, r, hex('#bfefff'));
          c.set(x - 1, y - 1, WHITE);
        }
        break;
      case 'extinguisher_cloud':
        outline = false;
        c.ellipse(16, 17, 13, 9, hex('#f0f0f0', 200));
        c.ellipse(10, 12, 7, 6, hex('#ffffff', 220)).ellipse(22, 12, 7, 6, hex('#ffffff', 220));
        break;
      case 'banana_slip':
        c.ellipse(16, 22, 6, 3, hex('#f4d03f'));
        c.line(11, 21, 7, 17, hex('#f4d03f'), 2).line(21, 21, 25, 17, hex('#f4d03f'), 2);
        c.line(5, 8, 13, 8, INK).line(9, 12, 17, 12, INK).line(15, 5, 23, 5, INK);
        break;
      case 'ko_stars':
        star(c, 8, 12, 4, hex('#ffe066'));
        star(c, 17, 7, 4, hex('#ffe066'));
        star(c, 25, 13, 4, hex('#ffe066'));
        break;
    }
    if (outline) c.outline(OUTLINE);
    return { name: id, canvas: c };
  });
}
