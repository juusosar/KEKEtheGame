// Character sheets (§11.1): greyscale player body, hat overlays and NPC sheets.
// Every sheet has the same frames: <anim>_<dir>_<i> for the animations below.
import { HAT_IDS } from '@keke/shared';
import { Canvas, OUTLINE, hex, type Rgba } from './canvas';
import type { Frame } from './atlas';

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** §11.1 animation set: name → frame count. */
export const CHARACTER_ANIMS = [
  { anim: 'idle', frames: 2 },
  { anim: 'walk', frames: 4 },
  { anim: 'attack', frames: 2 },
  { anim: 'hit', frames: 1 },
  { anim: 'ko', frames: 1 },
] as const;
export type CharacterAnim = (typeof CHARACTER_ANIMS)[number]['anim'];

/** Hat sheets come from the shared profile list, so the picker and the art can't drift apart. */
export const HATS = HAT_IDS;
export const NPC_SHEETS = ['stocker', 'security', 'butcher', 'customer'] as const;

export const FRAME = 32;

/** Where the head is in a frame, so hats can follow it. */
interface Pose {
  anim: CharacterAnim;
  dir: Direction;
  i: number;
  /** Vertical offset of head + torso (walk/idle bob). */
  bob: number;
  headCx: number;
  headCy: number;
}

const HEAD_RX = 8.5;
const HEAD_RY = 7;

function pose(anim: CharacterAnim, dir: Direction, i: number): Pose {
  const bob = (anim === 'idle' && i === 1) || (anim === 'walk' && i % 2 === 1) ? 1 : 0;
  if (anim === 'ko') return { anim, dir, i, bob: 0, headCx: dir === 'left' ? 24 : 8, headCy: 22 };
  const lean = anim === 'hit' ? (dir === 'left' ? 1 : dir === 'right' ? -1 : 0) : 0;
  return { anim, dir, i, bob, headCx: 16 + lean, headCy: 12 + bob + (anim === 'hit' ? 1 : 0) };
}

export interface CharacterPalette {
  skin: Rgba;
  hair: Rgba;
  shirt: Rgba;
  pants: Rgba;
  shoes: Rgba;
  eyes: Rgba;
}

/** §11.1: the player body is greyscale and tinted at runtime. */
const GREY_BODY: CharacterPalette = {
  skin: hex('#e8e8e8'),
  hair: hex('#7c7c7c'),
  shirt: hex('#c4c4c4'),
  pants: hex('#8e8e8e'),
  shoes: hex('#5c5c5c'),
  eyes: hex('#1a1a1a'),
};

function xEyes(c: Canvas, x: number, y: number, col: Rgba): void {
  c.set(x, y, col)
    .set(x + 2, y, col)
    .set(x + 1, y + 1, col)
    .set(x, y + 2, col)
    .set(x + 2, y + 2, col);
}

function drawFace(c: Canvas, p: Pose, pal: CharacterPalette): void {
  const { headCx: cx, headCy: cy, dir } = p;
  const dazed = p.anim === 'hit' || p.anim === 'ko';
  if (p.anim === 'ko') {
    xEyes(c, cx - 3, cy - 2, pal.eyes);
    return;
  }
  if (dir === 'up') {
    c.ellipse(cx, cy - 1, HEAD_RX - 1, HEAD_RY - 1.5, pal.hair);
    return;
  }
  // Hair fringe on top of the head.
  c.ellipse(cx, cy - 4, HEAD_RX - 1, 3, pal.hair);
  if (dir === 'down') {
    if (dazed) {
      xEyes(c, cx - 5, cy - 1, pal.eyes);
      xEyes(c, cx + 2, cy - 1, pal.eyes);
    } else {
      c.rect(cx - 4, cy - 1, 2, 3, pal.eyes).rect(cx + 2, cy - 1, 2, 3, pal.eyes);
    }
    c.rect(cx - 2, cy + 4, 4, 1, pal.eyes);
    return;
  }
  const s = dir === 'right' ? 1 : -1;
  if (dazed) xEyes(c, cx + s * 4 - 1, cy - 1, pal.eyes);
  else c.rect(cx + s * 4 - (s > 0 ? 0 : 1), cy - 1, 2, 3, pal.eyes);
  c.rect(cx + s * 8 - (s > 0 ? 0 : 1), cy + 1, 2, 2, pal.skin); // nose
}

function drawStanding(c: Canvas, p: Pose, pal: CharacterPalette): void {
  const { dir, anim, i, bob } = p;
  const cx = p.headCx;
  const torsoY = 19 + bob;
  const side = dir === 'left' || dir === 'right';
  // Legs (feet end at y = 29).
  if (side) {
    const apart = anim === 'walk' && i % 2 === 0;
    const flip = anim === 'walk' && i === 2;
    const back = apart ? (flip ? cx + 2 : cx - 4) : cx - 2;
    const front = apart ? (flip ? cx - 4 : cx + 2) : cx - 1;
    c.rect(back, 25, 3, 4, pal.shoes).rect(front, 25, 3, 4, pal.pants).rect(front, 28, 3, 1, pal.shoes);
  } else {
    const liftL = anim === 'walk' && i === 0 ? 1 : 0;
    const liftR = anim === 'walk' && i === 2 ? 1 : 0;
    c.rect(cx - 4, 25, 3, 4 - liftL, pal.pants).rect(cx - 4, 28 - liftL, 3, 1, pal.shoes);
    c.rect(cx + 1, 25, 3, 4 - liftR, pal.pants).rect(cx + 1, 28 - liftR, 3, 1, pal.shoes);
  }
  // Torso.
  c.rect(cx - 5, torsoY, 10, 25 - torsoY + 1, pal.shirt);
  // Arms; attack stretches the leading arm.
  const reach = anim === 'attack' ? (i === 0 ? 3 : 6) : 0;
  if (dir === 'down') {
    c.rect(cx - 7, torsoY + 1, 2, 5, pal.shirt).rect(cx + 5, torsoY + 1, 2, 5 + reach, pal.shirt);
    c.rect(cx + 5, torsoY + 5 + reach, 2, 1, pal.skin);
  } else if (dir === 'up') {
    c.rect(cx - 7, torsoY + 1, 2, 5, pal.shirt).rect(cx + 5, torsoY + 1 - reach, 2, 5, pal.shirt);
  } else {
    const s = dir === 'right' ? 1 : -1;
    const ax = s > 0 ? cx + 1 : cx - 3;
    c.rect(ax, torsoY + 1, 2, 4, pal.shirt);
    if (reach > 0) c.rect(s > 0 ? ax + 2 : ax - reach, torsoY + 2, reach, 2, pal.skin);
  }
  // Big head on top (§11: big head, small body).
  c.ellipse(cx, p.headCy, HEAD_RX, HEAD_RY, pal.skin);
  drawFace(c, p, pal);
}

function drawKo(c: Canvas, p: Pose, pal: CharacterPalette): void {
  const left = p.dir === 'left';
  const m = (x: number, w: number): number => (left ? FRAME - x - w : x); // mirror helper
  c.rect(m(16, 9), 18, 9, 8, pal.shirt);
  c.rect(m(25, 4), 19, 4, 3, pal.pants).rect(m(29, 1), 19, 1, 3, pal.shoes);
  c.rect(m(25, 4), 23, 4, 3, pal.pants).rect(m(29, 1), 23, 1, 3, pal.shoes);
  c.ellipse(p.headCx, p.headCy, HEAD_RY, HEAD_RX - 1.5, pal.skin);
  drawFace(c, p, pal);
}

type Decorate = (c: Canvas, p: Pose) => void;

function characterFrames(pal: CharacterPalette, decorate?: Decorate): Frame[] {
  const frames: Frame[] = [];
  for (const { anim, frames: count } of CHARACTER_ANIMS) {
    for (const dir of DIRECTIONS) {
      for (let i = 0; i < count; i++) {
        const p = pose(anim, dir, i);
        const c = new Canvas(FRAME, FRAME);
        if (anim === 'ko') drawKo(c, p, pal);
        else drawStanding(c, p, pal);
        decorate?.(c, p);
        c.outline(OUTLINE);
        frames.push({ name: `${anim}_${dir}_${i}`, canvas: c });
      }
    }
  }
  return frames;
}

export function bodyFrames(): Frame[] {
  return characterFrames(GREY_BODY);
}

// ── Hats ──────────────────────────────────────────────────────────────────────

type HatId = (typeof HATS)[number];

/** Draws a hat on a head whose centre is (cx, cy). */
function drawHat(c: Canvas, hat: HatId, cx: number, cy: number, dir: Direction): void {
  const top = Math.round(cy - HEAD_RY);
  const s = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  switch (hat) {
    case 'chef': {
      const white = hex('#fafafa');
      c.rect(cx - 6, top - 1, 12, 4, white);
      c.ellipse(cx, top - 3, 7, 3.5, white);
      c.rect(cx - 6, top + 2, 12, 1, hex('#d8d8d8'));
      break;
    }
    case 'cap': {
      const red = hex('#d23c3c');
      c.ellipse(cx, top + 3, HEAD_RX, 4, red);
      c.rect(cx - 8, top + 3, 16, 3, red);
      const brim = hex('#a82828');
      if (dir === 'down') c.rect(cx - 6, top + 6, 12, 2, brim);
      else if (s !== 0) c.rect(s > 0 ? cx + 6 : cx - 12, top + 5, 6, 2, brim);
      c.rect(cx - 1, top, 2, 1, hex('#ffffff'));
      break;
    }
    case 'beanie': {
      const blue = hex('#2f4fa0');
      c.ellipse(cx, top + 3, HEAD_RX + 0.5, 4.5, blue);
      c.rect(cx - 9, top + 3, 18, 3, blue);
      c.rect(cx - 9, top + 5, 18, 2, hex('#4a6cc4'));
      c.ellipse(cx, top - 1, 2, 2, hex('#f0f0f0'));
      break;
    }
    case 'hairnet': {
      const net = hex('#cfe8ff', 170);
      c.ellipse(cx, top + 3, HEAD_RX, 4.5, net);
      const knot = hex('#8fb8e0');
      for (let x = cx - 7; x <= cx + 7; x += 3) for (let y = top + 1; y <= top + 5; y += 2) c.set(x, y, knot);
      break;
    }
    case 'hardhat': {
      const yellow = hex('#f5c518');
      c.ellipse(cx, top + 3, HEAD_RX, 5, yellow);
      c.rect(cx - 10, top + 5, 20, 2, yellow);
      c.rect(cx - 1, top - 1, 2, 6, hex('#d9a90f'));
      break;
    }
  }
}

function hatFrames(hat: HatId): Frame[] {
  const frames: Frame[] = [];
  for (const { anim, frames: count } of CHARACTER_ANIMS) {
    for (const dir of DIRECTIONS) {
      for (let i = 0; i < count; i++) {
        const p = pose(anim, dir, i);
        const c = new Canvas(FRAME, FRAME);
        // On KO the hat pops off and lands upright above the fallen body.
        if (anim === 'ko') drawHat(c, hat, dir === 'left' ? 9 : 23, 15, 'down');
        else drawHat(c, hat, p.headCx, p.headCy, dir);
        c.outline(OUTLINE);
        frames.push({ name: `${anim}_${dir}_${i}`, canvas: c });
      }
    }
  }
  return frames;
}

export function hatSheets(): { key: string; frames: Frame[] }[] {
  return HATS.map((hat) => ({ key: `hat_${hat}`, frames: hatFrames(hat) }));
}

// ── NPCs ──────────────────────────────────────────────────────────────────────

type NpcId = (typeof NPC_SHEETS)[number];

const NPC_LOOKS: Record<NpcId, { pal: CharacterPalette; decorate?: Decorate }> = {
  stocker: {
    pal: {
      skin: hex('#f1c9a5'),
      hair: hex('#6b4423'),
      shirt: hex('#3a7d44'),
      pants: hex('#2e3a59'),
      shoes: hex('#222222'),
      eyes: hex('#1a1a1a'),
    },
    // Hi-vis stripe across the work shirt.
    decorate: (c, p) => {
      if (p.anim !== 'ko') c.rect(p.headCx - 5, 22 + p.bob, 10, 1, hex('#e8f05a'));
    },
  },
  security: {
    pal: {
      skin: hex('#c68e62'),
      hair: hex('#1e1e1e'),
      shirt: hex('#1f2a44'),
      pants: hex('#151a28'),
      shoes: hex('#0e0e0e'),
      eyes: hex('#1a1a1a'),
    },
    decorate: (c, p) => {
      if (p.anim === 'ko') return;
      if (p.dir !== 'up') c.rect(p.headCx + (p.dir === 'left' ? -2 : 1), 20 + p.bob, 2, 2, hex('#f5c518')); // badge
      drawHat(c, 'cap', p.headCx, p.headCy, p.dir);
    },
  },
  butcher: {
    pal: {
      skin: hex('#f4d0b5'),
      hair: hex('#b05a2a'),
      shirt: hex('#f2f2f2'),
      pants: hex('#5a5a5a'),
      shoes: hex('#222222'),
      eyes: hex('#1a1a1a'),
    },
    decorate: (c, p) => {
      if (p.anim === 'ko') return;
      if (p.dir !== 'up') {
        c.rect(p.headCx - 3, 20 + p.bob, 6, 6 - p.bob, hex('#ffffff'));
        c.set(p.headCx - 1, 22 + p.bob, hex('#c0392b')).set(p.headCx + 1, 24, hex('#c0392b')); // stains
      }
      drawHat(c, 'hairnet', p.headCx, p.headCy, p.dir);
    },
  },
  customer: {
    pal: {
      skin: hex('#e0b48c'),
      hair: hex('#3b2a1a'),
      shirt: hex('#8e44ad'),
      pants: hex('#34495e'),
      shoes: hex('#2c2c2c'),
      eyes: hex('#1a1a1a'),
    },
  },
};

export function npcSheets(): { key: string; frames: Frame[] }[] {
  return NPC_SHEETS.map((id) => ({
    key: id,
    frames: characterFrames(NPC_LOOKS[id].pal, NPC_LOOKS[id].decorate),
  }));
}
