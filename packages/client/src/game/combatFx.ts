// Combat visuals in the world (M4-2 placeholders, finished in M4-7): the held weapon sprite that follows
// the aim and swings, thrusts or blocks; per-mode attack FX (fxPlan.ts ATTACK_FX); hit sparks and splats;
// floating damage numbers; KO stars over a KO'd body; the stun ring, block shield and small HP bar.
// The Game scene feeds every combat broadcast to `onEvent` and calls `draw` once per frame.
import {
  CombatEventMessage,
  type AttackMessage,
  type AttackMode,
  type HitMessage,
  type KoMessage,
  type NpcAttackMessage,
  type NpcHitMessage,
  type NpcKoMessage,
  NpcEventMessage,
  type MeleeStats,
  type Vec2,
  type WeaponCatalogue,
} from '@keke/shared';
import type Phaser from 'phaser';
import type { CombatPlayerView } from '../net/combatView';
import { combatLook, hpBarFill, swingAngles, type CombatLook } from './combatLook';
import { attackFx, hitFx, koFx, npcAttackFx, type FxConfig, type FxSpec } from './fxPlan';
import type { KekeFxSnapshot, KekeHeldSnapshot, KekeSwingsSnapshot } from './hookTypes';
import { heldPose, swingProgress, turnToward, type HeldPose, type HeldSwing } from './heldPose';
import { renderConfig } from './renderConfig';
import { predictedSwingMode } from './swingPrediction';

/** A combat event as recorded for the debug hook. */
export interface CombatLogEntry {
  type: string;
  payload: unknown;
}

/** One body as the scene draws it this frame. */
export interface FxBody {
  id: string;
  pos: Vec2;
  combat: CombatPlayerView;
  /** Aim radians: our own from input, others from the synced `aim`. */
  aim: number;
  /** Shown as blocking (synced flag, or our own Block held with a blocking weapon). */
  blocking: boolean;
  visible: boolean;
  /** The body sprite's depth; the held weapon goes just above or below it. */
  depth: number;
}

/** Held weapon state for the debug hook (`__KEKE__.held()`). */
export type HeldSnapshot = KekeHeldSnapshot;

/** A live effect for the debug hook (`__KEKE__.fx()`). */
export type FxSnapshot = KekeFxSnapshot;

interface LiveFx {
  spec: FxSpec;
  start: number;
  obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Text | null;
}

const LOG_LIMIT = 50;
/** How fast a remote player's drawn aim turns toward the synced one, rad/s (patches arrive at 20 Hz). */
const AIM_TURN_RAD_PER_SECOND = 18;
/** A local swing predicted on the press hides the server's echo of it for this long, s. */
const ECHO_WINDOW_SECONDS = 0.6;

function fxSnapshot(spec: FxSpec): FxSnapshot {
  if (spec.kind === 'sprite') {
    return spec.follow === null
      ? { kind: spec.kind, frame: spec.frame }
      : { kind: spec.kind, frame: spec.frame, target: spec.follow };
  }
  if (spec.kind === 'number') return { kind: spec.kind, target: spec.target, text: spec.text };
  return { kind: spec.kind };
}

export class CombatFx {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly flashUntil = new Map<string, number>();
  private readonly log: CombatLogEntry[] = [];
  private live: LiveFx[] = [];
  /** Snapshots of recently started effects, kept after they end (see `startedSnapshots`). */
  private readonly started: FxSnapshot[] = [];
  private readonly swings = new Map<string, HeldSwing>();
  private readonly held = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly poses = new Map<string, { weapon: string; pose: HeldPose }>();
  private readonly drawnAim = new Map<string, number>();
  private readonly koStars = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly positions = new Map<string, Vec2>();
  private readonly fxCfg: FxConfig;
  private lastDraw = 0;
  /** Scene time of our last predicted swing (see `predictAttack`). */
  private predictedAt = -Infinity;
  private readyAt = 0;
  /** Swings predicted on our own presses so far, and the last one (`__KEKE__.swings()`). */
  private predicted = 0;
  private lastPredicted: KekeSwingsSnapshot['last'] = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly weapons: WeaponCatalogue,
    private readonly maxHp: number,
    private readonly me: string,
    tileSize: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
    this.fxCfg = { ...renderConfig, tileSize };
  }

  /** Feed every combat broadcast here; `now` is the scene clock in seconds. */
  onEvent(type: string, payload: unknown, now: number): void {
    this.log.push({ type, payload });
    if (this.log.length > LOG_LIMIT) this.log.shift();
    if (type === CombatEventMessage.attack) {
      const a = payload as AttackMessage;
      const def = this.weapons.get(a.weapon);
      this.spawn(attackFx(a, def, this.fxCfg), now);
      const echo = a.player === this.me && now - this.predictedAt < ECHO_WINDOW_SECONDS && a.mode !== 'spray';
      if (!echo) this.startSwing(a.player, a.mode, a.aim, a.weapon, now);
    } else if (type === CombatEventMessage.hit) {
      const h = payload as HitMessage;
      if (h.damage > 0) this.flashUntil.set(h.target, now + renderConfig.hitFlashSeconds);
      this.spawn(hitFx(h, this.me, this.fxCfg), now);
    } else if (type === CombatEventMessage.ko) {
      const k = payload as KoMessage;
      this.spawn(koFx(k.player, this.fxCfg), now);
    }
  }

  /**
   * Store worker events (M5-7): the NPC's swing wedge, the spark and damage number on a hit NPC, the KO
   * burst. `melee` sizes the wedge (npcs.json). NPC positions come in through `draw`'s `anchors`.
   */
  onNpcEvent(
    type: string,
    payload: unknown,
    now: number,
    melee: Pick<MeleeStats, 'rangePx' | 'arcDegrees'> | null,
  ): void {
    if (typeof payload !== 'object' || payload === null) return;
    this.log.push({ type, payload });
    if (this.log.length > LOG_LIMIT) this.log.shift();
    if (type === NpcEventMessage.npcAttack) {
      this.spawn(npcAttackFx(payload as NpcAttackMessage, melee, this.fxCfg), now);
    } else if (type === NpcEventMessage.npcHit) {
      const h = payload as NpcHitMessage;
      this.spawn(hitFx({ target: h.npc, weapon: h.weapon, damage: h.damage }, this.me, this.fxCfg), now);
    } else if (type === NpcEventMessage.npcKo) {
      this.spawn(koFx((payload as NpcKoMessage).npc, this.fxCfg), now);
    }
  }

  /**
   * Our own Attack press: start the held weapon's swing at once instead of a round trip later. Uses the
   * weapon's cooldown so a press the server will refuse does not swing. Returns true when it swung.
   */
  predictAttack(combat: CombatPlayerView, aim: number, now: number): boolean {
    const def = this.weapons.get(combat.weapon);
    const mode = predictedSwingMode(combat, def, now, this.readyAt);
    if (mode === null || !def) return false;
    this.readyAt = now + def.cooldownSeconds;
    this.predictedAt = now;
    this.predicted++;
    this.lastPredicted = { weapon: combat.weapon, mode, at: now };
    this.startSwing(this.me, mode, aim, combat.weapon, now);
    return true;
  }

  /**
   * Swings predicted on our own presses. A counter rather than the 0.18 s `held().swinging` window, so a
   * spec on a slow page (a few fps) can still prove the press swung (M4 review F1).
   */
  swingSnapshot(): KekeSwingsSnapshot {
    return { predicted: this.predicted, last: this.lastPredicted ? { ...this.lastPredicted } : null };
  }

  private startSwing(id: string, mode: AttackMode, aim: number, weapon: string, now: number): void {
    const def = this.weapons.get(weapon);
    const arc = def && 'melee' in def ? def.melee.arcDegrees : 0;
    this.swings.set(id, { mode, start: now, aim, arcDegrees: arc, drawn: false });
  }

  /** Recent combat events, oldest first (debug hook). */
  events(): CombatLogEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  /** How a body should look now. */
  lookFor(id: string, combat: CombatPlayerView, now: number): CombatLook {
    return combatLook(combat, now, this.flashUntil.get(id) ?? 0, renderConfig);
  }

  heldSnapshots(): HeldSnapshot[] {
    const out: HeldSnapshot[] = [];
    for (const [id, { weapon, pose }] of this.poses) {
      out.push({
        id,
        weapon,
        visible: pose.visible,
        frame: this.weapons.get(weapon)?.sprite ?? weapon,
        angle: pose.angle,
        x: pose.x,
        y: pose.y,
        swinging: pose.swingProgress !== null,
        blocking: pose.blocking,
      });
    }
    return out;
  }

  fxSnapshots(): FxSnapshot[] {
    return this.live.map(({ spec }) => fxSnapshot(spec));
  }

  /** The last 50 effects started, oldest first, also those already over (`__KEKE__.fxStarted()`). */
  startedSnapshots(): FxSnapshot[] {
    return this.started.map((f) => ({ ...f }));
  }

  /**
   * Redraws everything. `bodies` are the players drawn this frame; `anchors` are other things effects may
   * follow (store workers, M5-7).
   */
  draw(now: number, bodies: readonly FxBody[], anchors?: ReadonlyMap<string, Vec2>): void {
    const dt = Math.max(0, Math.min(0.1, now - this.lastDraw));
    this.lastDraw = now;
    this.positions.clear();
    if (anchors) for (const [id, pos] of anchors) this.positions.set(id, pos);
    for (const b of bodies) if (b.visible) this.positions.set(b.id, b.pos);

    const g = this.g;
    g.clear();
    this.drawLive(now);
    const seen = new Set<string>();
    for (const body of bodies) {
      seen.add(body.id);
      this.drawHeld(body, now, dt);
      this.drawKoStars(body, now);
      if (!body.visible) continue;
      this.drawStatus(body);
    }
    for (const [id, sprite] of this.held) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.held.delete(id);
      this.poses.delete(id);
      this.drawnAim.delete(id);
      this.swings.delete(id);
    }
    for (const [id, stars] of this.koStars) {
      if (seen.has(id)) continue;
      stars.destroy();
      this.koStars.delete(id);
    }
  }

  destroy(): void {
    this.g.destroy();
    for (const fx of this.live) fx.obj?.destroy();
    this.live = [];
    for (const s of this.held.values()) s.destroy();
    this.held.clear();
    for (const s of this.koStars.values()) s.destroy();
    this.koStars.clear();
  }

  // --- parts ----------------------------------------------------------------------------------------

  private spawn(specs: FxSpec[], now: number): void {
    for (const spec of specs) {
      let obj: LiveFx['obj'] = null;
      if (spec.kind === 'sprite' && this.scene.textures.exists('fx')) {
        obj = this.scene.add.sprite(spec.x, spec.y, 'fx', spec.frame).setDepth(this.depth + 1);
      } else if (spec.kind === 'number') {
        obj = this.scene.add
          .text(0, 0, spec.text, {
            fontFamily: 'monospace',
            fontSize: '9px',
            fontStyle: 'bold',
            color: spec.color,
            stroke: '#000000',
            strokeThickness: 2,
            resolution: renderConfig.cameraZoom * 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(this.depth + 2);
      }
      this.live.push({ spec, start: now, obj });
      this.started.push(fxSnapshot(spec));
      if (this.started.length > LOG_LIMIT) this.started.shift();
    }
  }

  private drawLive(now: number): void {
    const g = this.g;
    const keep: LiveFx[] = [];
    for (const fx of this.live) {
      const { spec } = fx;
      const t = (now - fx.start) / spec.seconds;
      if (t >= 1) {
        fx.obj?.destroy();
        continue;
      }
      keep.push(fx);
      const left = 1 - t;
      if (spec.kind === 'wedge') {
        const [from, to] = swingAngles(spec.aim, spec);
        g.fillStyle(spec.color, spec.alpha * left);
        g.slice(spec.x, spec.y, spec.rangePx, from, to, false);
        g.fillPath();
      } else if (spec.kind === 'trail') {
        const ex = spec.x + Math.cos(spec.aim) * spec.lengthPx;
        const ey = spec.y + Math.sin(spec.aim) * spec.lengthPx;
        g.lineStyle(spec.widthPx, spec.color, 0.35 * left);
        g.lineBetween(spec.x, spec.y, ex, ey);
      } else if (spec.kind === 'sprite' && fx.obj) {
        const at = spec.follow === null ? { x: spec.x, y: spec.y } : this.positions.get(spec.follow);
        if (!at) {
          fx.obj.setVisible(false);
          continue;
        }
        const lift = spec.follow === null ? 0 : renderConfig.heldWeaponLiftPx;
        (fx.obj as Phaser.GameObjects.Sprite)
          .setVisible(true)
          .setPosition(at.x, at.y - lift - spec.risePx * t)
          .setScale(spec.scaleFrom + (spec.scaleTo - spec.scaleFrom) * t)
          .setAlpha(Math.min(1, left * 2));
      } else if (spec.kind === 'number' && fx.obj) {
        const at = this.positions.get(spec.target);
        if (!at) {
          fx.obj.setVisible(false);
          continue;
        }
        fx.obj
          .setVisible(true)
          .setPosition(
            Math.round(at.x),
            Math.round(at.y - renderConfig.hpBarOffsetY - 2 - renderConfig.damageNumberRisePx * t),
          )
          .setAlpha(Math.min(1, left * 2));
      }
    }
    this.live = keep;
  }

  private drawHeld(body: FxBody, now: number, dt: number): void {
    const prev = this.drawnAim.get(body.id);
    const aim =
      body.id === this.me || prev === undefined
        ? body.aim
        : turnToward(prev, body.aim, AIM_TURN_RAD_PER_SECOND * dt);
    this.drawnAim.set(body.id, aim);
    const swing = this.swings.get(body.id) ?? null;
    // A swing is shown at least once: on a page drawing a few frames a second the whole 0.18 s swing
    // can fall between two frames, so the first frame after it started draws it from the beginning.
    if (swing !== null && !swing.drawn) {
      swing.drawn = true;
      if (swingProgress(swing, now, renderConfig.heldSwingSeconds) === null && now >= swing.start)
        swing.start = now;
    }
    const pose = heldPose(
      {
        x: body.pos.x,
        y: body.pos.y,
        aim,
        weapon: body.combat.weapon,
        alive: body.combat.alive,
        visible: body.visible,
        blocking: body.blocking,
        charging: body.combat.charging,
        swing,
        now,
      },
      renderConfig,
    );
    if (swing !== null && pose.swingProgress === null) this.swings.delete(body.id);
    this.poses.set(body.id, { weapon: body.combat.weapon, pose });

    let sprite = this.held.get(body.id);
    if (!pose.visible) {
      sprite?.setVisible(false);
      return;
    }
    if (!this.scene.textures.exists('weapons')) return;
    const frame = this.weapons.get(body.combat.weapon)?.sprite ?? body.combat.weapon;
    if (!sprite) {
      sprite = this.scene.add.sprite(0, 0, 'weapons', frame).setScale(renderConfig.heldWeaponScale);
      this.held.set(body.id, sprite);
    }
    if (sprite.frame.name !== frame && this.scene.textures.get('weapons').has(frame)) sprite.setFrame(frame);
    sprite
      .setVisible(true)
      .setPosition(pose.x, pose.y)
      .setRotation(pose.angle)
      .setFlipY(pose.flipY)
      .setDepth(body.depth + (pose.behind ? -0.001 : 0.002));

    if (pose.blocking) {
      // Shield arc in front of the body while the pan blocks.
      const r = renderConfig.heldWeaponReachPx + 6;
      const cy = body.pos.y - renderConfig.heldWeaponLiftPx;
      this.g.lineStyle(2, 0x9ad8ff, 0.85);
      this.g.beginPath();
      this.g.arc(body.pos.x, cy, r, aim - 0.6, aim + 0.6, false);
      this.g.strokePath();
    }
  }

  /** KO stars over a KO'd body, the banana slip frame over a sliding one (M4-5 `sliding`). */
  private drawKoStars(body: FxBody, now: number): void {
    let stars = this.koStars.get(body.id);
    const frame = !body.visible
      ? null
      : !body.combat.alive
        ? 'ko_stars'
        : body.combat.sliding
          ? 'banana_slip'
          : null;
    if (frame === null) {
      stars?.setVisible(false);
      return;
    }
    if (!this.scene.textures.exists('fx')) return;
    if (!stars) {
      stars = this.scene.add
        .sprite(0, 0, 'fx', frame)
        .setDepth(this.depth + 1)
        .setScale(0.6);
      this.koStars.set(body.id, stars);
    }
    if (stars.frame.name !== frame) stars.setFrame(frame);
    stars
      .setVisible(true)
      .setPosition(body.pos.x, body.pos.y - renderConfig.koStarsOffsetY)
      .setRotation(now * renderConfig.koStarsSpinHz * (frame === 'banana_slip' ? 4 : 1) * Math.PI * 2);
  }

  private drawStatus(body: FxBody): void {
    const g = this.g;
    const { pos, combat } = body;
    if (combat.charging) {
      // Dust kicked up behind a pallet jack dash (M4-6 `charging`).
      const back = body.aim + Math.PI;
      for (let i = 1; i <= 3; i++) {
        const d = 6 + i * 6;
        const jitter = ((i * 7) % 5) - 2;
        g.fillStyle(0xc8b48a, 0.5 - i * 0.12);
        g.fillCircle(
          pos.x + Math.cos(back) * d + Math.cos(back + Math.PI / 2) * jitter,
          pos.y + Math.sin(back) * d + Math.sin(back + Math.PI / 2) * jitter,
          4 - i * 0.8,
        );
      }
    }
    if (combat.stunned) {
      g.lineStyle(1, 0xffe14d, 1);
      g.strokeEllipse(pos.x, pos.y - renderConfig.hpBarOffsetY + 4, 14, 5);
    }
    const fill = hpBarFill(combat, this.maxHp);
    if (fill === null) return;
    const w = renderConfig.hpBarWidthPx;
    const x = Math.round(pos.x - w / 2);
    const y = Math.round(pos.y - renderConfig.hpBarOffsetY);
    g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 4);
    g.fillStyle(fill > 0.5 ? 0x4caf50 : fill > 0.25 ? 0xffc107 : 0xe53935, 1).fillRect(x, y, w * fill, 2);
  }
}
