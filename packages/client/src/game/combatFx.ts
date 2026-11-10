// Minimal combat feedback in the world (M4-2): melee swing wedges from `attack` events, white hit flashes,
// a stun ring and a small HP bar over hurt players. The held-weapon sprite, attack FX polish, HUD HP bar,
// weapon/uses slot, KO overlay and feed lines are M4-7's.
import {
  CombatEventMessage,
  type AttackMessage,
  type HitMessage,
  type Vec2,
  type WeaponCatalogue,
} from '@keke/shared';
import type Phaser from 'phaser';
import type { CombatPlayerView } from '../net/combatView';
import { combatLook, hpBarFill, swingAngles, type CombatLook } from './combatLook';
import { renderConfig } from './renderConfig';

interface Swing {
  x: number;
  y: number;
  aim: number;
  rangePx: number;
  arcDegrees: number;
  /** Seconds (scene clock) the wedge disappears. */
  until: number;
}

/** A combat event as recorded for the debug hook. */
export interface CombatLogEntry {
  type: string;
  payload: unknown;
}

const LOG_LIMIT = 50;

export class CombatFx {
  private readonly g: Phaser.GameObjects.Graphics;
  private swings: Swing[] = [];
  private readonly flashUntil = new Map<string, number>();
  private readonly log: CombatLogEntry[] = [];

  constructor(
    scene: Phaser.Scene,
    depth: number,
    private readonly weapons: WeaponCatalogue,
    private readonly maxHp: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  /** Feed every combat broadcast here; `now` is the scene clock in seconds. */
  onEvent(type: string, payload: unknown, now: number): void {
    this.log.push({ type, payload });
    if (this.log.length > LOG_LIMIT) this.log.shift();
    if (type === CombatEventMessage.attack) {
      const a = payload as AttackMessage;
      const def = this.weapons.get(a.weapon);
      if (a.mode !== 'melee' || !def || !('melee' in def)) return;
      this.swings.push({
        x: a.x,
        y: a.y,
        aim: a.aim,
        rangePx: def.melee.rangePx,
        arcDegrees: def.melee.arcDegrees,
        until: now + renderConfig.swingFxSeconds,
      });
    } else if (type === CombatEventMessage.hit) {
      const h = payload as HitMessage;
      this.flashUntil.set(h.target, now + renderConfig.hitFlashSeconds);
    }
  }

  /** Recent combat events, oldest first (debug hook). */
  events(): CombatLogEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  /** How a body should look now. */
  lookFor(id: string, combat: CombatPlayerView, now: number): CombatLook {
    return combatLook(combat, now, this.flashUntil.get(id) ?? 0, renderConfig);
  }

  /** Redraws swings, stun rings and HP bars. `bodies` are drawn positions of players on the map. */
  draw(now: number, bodies: readonly { pos: Vec2; combat: CombatPlayerView }[]): void {
    const g = this.g;
    g.clear();
    this.swings = this.swings.filter((s) => s.until > now);
    for (const s of this.swings) {
      const [from, to] = swingAngles(s.aim, s);
      const left = (s.until - now) / renderConfig.swingFxSeconds;
      g.fillStyle(0xffffff, 0.35 * left);
      g.slice(s.x, s.y, s.rangePx, from, to, false);
      g.fillPath();
    }
    const w = renderConfig.hpBarWidthPx;
    for (const { pos, combat } of bodies) {
      if (combat.stunned) {
        g.lineStyle(1, 0xffe14d, 1);
        g.strokeEllipse(pos.x, pos.y - renderConfig.hpBarOffsetY + 4, 14, 5);
      }
      const fill = hpBarFill(combat, this.maxHp);
      if (fill === null) continue;
      const x = Math.round(pos.x - w / 2);
      const y = Math.round(pos.y - renderConfig.hpBarOffsetY);
      g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(fill > 0.5 ? 0x4caf50 : fill > 0.25 ? 0xffc107 : 0xe53935, 1).fillRect(x, y, w * fill, 2);
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
