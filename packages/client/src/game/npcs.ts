// Store workers and stock carts in the world (M5-7). One sprite per synced NPC from its own sheet
// (npcs.json `sprite`: stocker, security, butcher, forklift), interpolated ~100 ms in the past like remote
// players. Feedback from the NPC events: swing pose on `npcAttack`, white flash + hit pose on `npcHit`,
// KO pose and stars while down, a fresh start on `npcRespawn`. A red anger mark shows while an NPC is
// after someone (synced `target`), a small HP bar while hurt, and a blinking warning light around a
// forklift. Stock carts are drawn over the tiles they block. The pose rules are in npcLook.ts.
// Customers (P2-4): each one uses its sheet or a look variant (`customer_2`...), shows a yellow fright
// mark while it panics (a `gasp` callback fires when a panic starts), and its drawn body is a solid
// circle for our prediction (`solidBodies`), like the server's.
import {
  NpcEventMessage,
  type Circle,
  type NpcAttackMessage,
  type NpcCatalogue,
  type NpcHitMessage,
  type Vec2,
} from '@keke/shared';
import type Phaser from 'phaser';
import { SnapshotBuffer } from '../net/interpolation';
import type { NpcView, StockCartView } from '../net/npcView';
import type { Facing } from './facing';
import type { KekeNpcSpriteSnapshot } from './hookTypes';
import {
  facingFromAim,
  forkliftBeepDue,
  forkliftBeeping,
  npcLook,
  npcSheetVariant,
  panicStarted,
  type NpcLook,
} from './npcLook';
import { renderConfig } from './renderConfig';

interface Entry {
  view: NpcView;
  sheet: string;
  sprite: Phaser.GameObjects.Sprite;
  mark: Phaser.GameObjects.Text;
  stars: Phaser.GameObjects.Sprite | null;
  buffer: SnapshotBuffer;
  facing: Facing;
  attackUntil: number;
  flashUntil: number;
  lastBeep: number;
  look: NpcLook | null;
  flashed: boolean;
  /** Synced mode seen on the last frame (panic start); undefined before the first frame. */
  lastMode: string | undefined;
  /** Colour the mark text has now (anger red or fright yellow). */
  markColor: string;
  /** Drawn position this frame, null before the first sample. */
  pos: Vec2 | null;
}

/** How long the swing pose holds after an `npcAttack`, s. */
const ATTACK_POSE_SECONDS = 0.25;
/** Forklift light colour (amber). */
const LIGHT = 0xffa000;
/** Mark colours: anger (after someone) and fright (a panicking customer). */
const ANGER = '#ff3b30';
const FRIGHT = '#ffd60a';

export interface NpcDepths {
  /** Characters layer: NPCs sort with players by y in [npc, npc + 0.5]. */
  npc: number;
  /** Floor-level things over the floor, under characters (light glow, carts). */
  floor: number;
  label: number;
  mapHeight: number;
}

export class NpcRenderer {
  private readonly entries = new Map<string, Entry>();
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly floorG: Phaser.GameObjects.Graphics;
  private carts: StockCartView[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depths: NpcDepths,
    private readonly catalogue: NpcCatalogue,
    private readonly tileSize: number,
    private readonly patchIntervalMs: number,
  ) {
    this.g = scene.add.graphics().setDepth(depths.label - 0.5);
    this.floorG = scene.add.graphics().setDepth(depths.floor);
  }

  /** From every state patch: who is in the round, where they are, the parked carts. */
  sync(npcs: readonly NpcView[], carts: readonly StockCartView[], nowMs: number): void {
    const seen = new Set<string>();
    for (const view of npcs) {
      seen.add(view.id);
      let entry = this.entries.get(view.id);
      if (!entry) {
        entry = this.create(view);
        this.entries.set(view.id, entry);
      }
      entry.view = view;
      entry.buffer.push(nowMs, view.x, view.y);
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.destroyEntry(entry);
      this.entries.delete(id);
    }
    this.carts = [...carts];
  }

  /** Feed every NPC event here; `now` is the scene clock in seconds. */
  onEvent(type: string, payload: unknown, now: number): void {
    if (typeof payload !== 'object' || payload === null) return;
    const id = (payload as { npc?: unknown }).npc;
    if (typeof id !== 'string') return;
    const entry = this.entries.get(id);
    if (!entry) return;
    if (type === NpcEventMessage.npcAttack) {
      const a = payload as NpcAttackMessage;
      entry.attackUntil = now + ATTACK_POSE_SECONDS;
      entry.facing = facingFromAim(a.aim, entry.facing);
    } else if (type === NpcEventMessage.npcHit) {
      const h = payload as NpcHitMessage;
      if (h.damage > 0) entry.flashUntil = now + Math.max(renderConfig.hitFlashSeconds, 0.15);
    } else if (type === NpcEventMessage.npcKo) {
      entry.attackUntil = 0;
    } else if (type === NpcEventMessage.npcRespawn) {
      // Back at its spawn: jump there instead of sliding across the store.
      entry.buffer.clear();
      entry.flashUntil = 0;
      entry.attackUntil = 0;
    }
  }

  /** Type id of an NPC in the round (feed names), or undefined. */
  typeOf(id: string): string | undefined {
    return this.entries.get(id)?.view.type;
  }

  /** Synced state of one NPC (wedge sizes), or undefined. */
  view(id: string): NpcView | undefined {
    return this.entries.get(id)?.view;
  }

  /**
   * Draws every NPC for this frame. Returns where each visible NPC is drawn (for hit sparks and damage
   * numbers) and calls `beep` for each forklift beep due this frame. Forklifts beep and light up only
   * while `playing`.
   */
  draw(
    now: number,
    nowMs: number,
    playing: boolean,
    beep: (id: string, at: Vec2) => void,
    gasp: (id: string, at: Vec2) => void = () => undefined,
  ): Map<string, Vec2> {
    const positions = new Map<string, Vec2>();
    const g = this.g;
    const fg = this.floorG;
    g.clear();
    fg.clear();
    this.drawCarts(fg);
    for (const [id, e] of this.entries) {
      const pos = e.buffer.sample(nowMs) ?? (e.pos === null ? { x: e.view.x, y: e.view.y } : e.pos);
      e.pos = pos;
      if (e.view.moving || e.view.behaviour === 'forklift') e.facing = facingFromAim(e.view.aim, e.facing);
      const look = npcLook(
        {
          npc: e.view,
          sheet: e.sheet,
          facing: e.facing,
          now,
          attackUntil: e.attackUntil,
          flashUntil: e.flashUntil,
          playing,
        },
        (key) => this.scene.anims.exists(key),
      );
      e.look = look;
      this.apply(e, look, pos);
      positions.set(id, pos);
      if (panicStarted(e.lastMode, e.view)) gasp(id, pos);
      e.lastMode = e.view.mode;

      if (look.light) this.drawLight(fg, g, e, pos, now);
      if (e.view.behaviour === 'forklift') {
        const def = this.catalogue.get(e.view.type);
        const interval = def?.behaviour === 'forklift' ? def.warning.beepIntervalSeconds : 0.8;
        const due = forkliftBeepDue(forkliftBeeping(e.view, playing), e.lastBeep, now, interval);
        if (due !== null) {
          e.lastBeep = due;
          beep(id, pos);
        }
      }
      if (look.hpFill !== null) {
        const w = renderConfig.hpBarWidthPx;
        const x = Math.round(pos.x - w / 2);
        const y = Math.round(pos.y - renderConfig.hpBarOffsetY);
        const fill = look.hpFill;
        g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 4);
        g.fillStyle(fill > 0.5 ? 0xff9800 : fill > 0.25 ? 0xffc107 : 0xe53935, 1).fillRect(x, y, w * fill, 2);
      }
    }
    return positions;
  }

  /**
   * Solid bodies as drawn (npcs.json `solid`: customers, Phase 2 decision 8), circles of radius
   * `hitboxPx / 2` at the interpolated positions of the last `draw`. Our prediction walks around them
   * like the server does (P2-4); the small lag behind the server is corrected by reconcile.
   */
  solidBodies(): Circle[] {
    const out: Circle[] = [];
    for (const e of this.entries.values()) {
      if (!e.view.alive) continue;
      const def = this.catalogue.get(e.view.type);
      if (def?.solid !== true) continue;
      const at = e.pos ?? { x: e.view.x, y: e.view.y };
      out.push({ x: at.x, y: at.y, r: def.hitboxPx / 2 });
    }
    return out;
  }

  /** Debug hook. */
  snapshots(): KekeNpcSpriteSnapshot[] {
    const out: KekeNpcSpriteSnapshot[] = [];
    for (const [id, e] of this.entries) {
      out.push({
        id,
        type: e.view.type,
        sheet: e.sheet,
        anim: e.look?.anim ?? '',
        visible: e.sprite.visible,
        x: e.pos?.x ?? e.view.x,
        y: e.pos?.y ?? e.view.y,
        alpha: e.sprite.alpha,
        hostile: e.look?.hostile ?? false,
        alarmed: e.look?.alarmed ?? false,
        light: e.look?.light ?? false,
      });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  destroy(): void {
    for (const e of this.entries.values()) this.destroyEntry(e);
    this.entries.clear();
    this.g.destroy();
    this.floorG.destroy();
  }

  // --- parts ----------------------------------------------------------------------------------------

  private create(view: NpcView): Entry {
    const def = this.catalogue.get(view.type);
    const wanted = def?.sprite ?? view.type;
    const exists = (key: string): boolean => this.scene.textures.exists(key);
    const sheet = exists(wanted) ? npcSheetVariant(view.id, wanted, exists) : 'customer';
    const forklift = view.behaviour === 'forklift';
    const sprite = this.scene.add
      .sprite(view.x, view.y, sheet)
      .setOrigin(0.5, forklift ? 0.5 : renderConfig.playerOriginY);
    const mark = this.scene.add
      .text(0, 0, '!', {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: ANGER,
        stroke: '#000000',
        strokeThickness: 2,
        resolution: renderConfig.cameraZoom * 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(this.depths.label)
      .setVisible(false);
    return {
      view,
      sheet,
      sprite,
      mark,
      stars: null,
      buffer: new SnapshotBuffer({
        delayMs: renderConfig.interpolationDelayMs,
        snapDistance: renderConfig.snapDistancePx,
        patchIntervalMs: this.patchIntervalMs,
      }),
      facing: facingFromAim(view.aim, 'down'),
      attackUntil: 0,
      flashUntil: 0,
      lastBeep: -Infinity,
      look: null,
      flashed: false,
      lastMode: undefined,
      markColor: ANGER,
      pos: null,
    };
  }

  private apply(e: Entry, look: NpcLook, pos: Vec2): void {
    const { sprite } = e;
    if (this.scene.anims.exists(look.anim)) sprite.play(look.anim, true);
    const depth = this.depths.npc + Math.max(0, Math.min(1, pos.y / this.depths.mapHeight)) * 0.5;
    sprite.setPosition(pos.x, pos.y).setDepth(depth).setAlpha(look.alpha).setVisible(true);
    if (look.flash !== e.flashed) {
      e.flashed = look.flash;
      if (look.flash) sprite.setTintFill(0xffffff);
      else sprite.clearTint();
    }
    // Anger (red) or fright (yellow) mark over the head, bobbing; fright bobs faster.
    const color = look.hostile ? ANGER : FRIGHT;
    if (color !== e.markColor) {
      e.markColor = color;
      e.mark.setColor(color);
    }
    const bob = Math.round(Math.sin(this.scene.time.now / (look.alarmed ? 60 : 120)) * 1);
    e.mark
      .setVisible(look.hostile || look.alarmed)
      .setPosition(Math.round(pos.x), Math.round(pos.y - renderConfig.nameplateOffsetY + bob));
    // KO stars while down (forklifts never go down).
    const down = !e.view.alive && e.view.behaviour !== 'forklift';
    if (down && !e.stars && this.scene.textures.exists('fx')) {
      e.stars = this.scene.add
        .sprite(0, 0, 'fx', 'ko_stars')
        .setScale(0.6)
        .setDepth(this.depths.label - 1);
    }
    if (e.stars) {
      e.stars
        .setVisible(down)
        .setPosition(pos.x, pos.y - renderConfig.koStarsOffsetY)
        .setRotation((this.scene.time.now / 1000) * renderConfig.koStarsSpinHz * Math.PI * 2);
    }
  }

  /** Amber glow on the floor around a forklift and a beacon on its roof, blinking (§8, §11.1). */
  private drawLight(
    floor: Phaser.GameObjects.Graphics,
    top: Phaser.GameObjects.Graphics,
    e: Entry,
    pos: Vec2,
    now: number,
  ): void {
    const def = this.catalogue.get(e.view.type);
    const radius = def?.behaviour === 'forklift' ? def.warning.lightRadiusPx : 96;
    const on = Math.floor(now * renderConfig.forkliftLightBlinkHz * 2) % 2 === 0;
    const strength = on ? 1 : 0.45;
    for (let i = 3; i >= 1; i--) {
      floor.fillStyle(LIGHT, 0.06 * strength);
      floor.fillCircle(pos.x, pos.y, (radius * i) / 3);
    }
    top.fillStyle(on ? LIGHT : 0x7a4a00, 1);
    top.fillCircle(pos.x, pos.y - 14, 3);
  }

  /** Placeholder cart: a steel frame over its tiles with a few boxes on it. */
  private drawCarts(g: Phaser.GameObjects.Graphics): void {
    const ts = this.tileSize;
    for (const cart of this.carts) {
      const x = cart.tx * ts;
      const y = cart.ty * ts;
      const w = cart.w * ts;
      const h = cart.h * ts;
      g.fillStyle(0x000000, 0.25).fillRect(x + 3, y + 5, w - 4, h - 4);
      g.fillStyle(0x9aa4ad, 1).fillRect(x + 2, y + 2, w - 4, h - 4);
      g.lineStyle(2, 0x56606a, 1).strokeRect(x + 2, y + 2, w - 4, h - 4);
      const boxes = Math.max(1, cart.w * cart.h);
      for (let i = 0; i < boxes; i++) {
        const bx = x + 6 + (i % cart.w) * ts;
        const by = y + 6 + Math.floor(i / cart.w) * ts;
        g.fillStyle(0xc68a4a, 1).fillRect(bx, by, ts - 12, ts - 12);
        g.lineStyle(1, 0x7a5228, 1).strokeRect(bx, by, ts - 12, ts - 12);
      }
    }
  }

  private destroyEntry(e: Entry): void {
    e.sprite.destroy();
    e.mark.destroy();
    e.stars?.destroy();
  }
}
