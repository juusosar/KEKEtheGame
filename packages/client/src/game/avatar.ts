// One drawn character: tinted body, hat, and (in a room) a nameplate. Used for the local player and
// for every remote player in the Game scene.
import { HAT_IDS } from '@keke/shared';
import Phaser from 'phaser';
import { NEUTRAL_LOOK, type CombatLook } from './combatLook';
import { animKey, facingFromMove, type Facing } from './facing';
import { renderConfig } from './renderConfig';

export interface AvatarLook {
  nickname: string;
  /** `#RRGGBB`. */
  color: string;
  hat: string;
}

/** Below this many pixels per render frame a remote player counts as standing (patch jitter). */
const WALK_EPSILON_PX = 0.05;

export class Avatar {
  readonly body: Phaser.GameObjects.Sprite;
  private readonly hat: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text | null;
  private facing: Facing = 'down';
  private look: AvatarLook | null = null;
  private labelText = '';
  private last: { x: number; y: number } | null = null;
  private labelLift = 0;
  private tint = 0xffffff;
  private connectedAlpha = 1;
  private combat: CombatLook = NEUTRAL_LOOK;
  /** Wanted ❗ over the head (§8, M5-7); made on first use. */
  private wantedIcon: Phaser.GameObjects.Text | null = null;
  private wanted = false;
  private visible = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: { player: number; label: number; mapHeight: number },
    withLabel: boolean,
  ) {
    this.body = scene.add.sprite(0, 0, 'body').setOrigin(0.5, renderConfig.playerOriginY);
    this.hat = scene.add.sprite(0, 0, `hat_${HAT_IDS[0]}`).setOrigin(0.5, renderConfig.playerOriginY);
    this.label = withLabel
      ? scene.add
          .text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.45)',
            padding: { x: 2, y: 0 },
            resolution: renderConfig.cameraZoom * 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(depth.label)
      : null;
    this.body.play(animKey('body', false, this.facing));
  }

  /** Colour, hat and name. Cheap to call every frame: only changes are applied. */
  setLook(look: AvatarLook): void {
    const prev = this.look;
    if (prev?.color !== look.color) {
      const color = /^#[0-9a-f]{6}$/i.test(look.color) ? look.color : '#ffffff';
      this.tint = Phaser.Display.Color.HexStringToColor(color).color;
      if (!this.combat.flash) this.body.setTint(this.tint);
    }
    if (prev?.hat !== look.hat) {
      const key = `hat_${look.hat}`;
      this.hat.setTexture(this.scene.textures.exists(key) ? key : `hat_${HAT_IDS[0]}`);
    }
    this.look = look;
  }

  /** Nameplate text (nickname, plus a note while reconnecting). */
  setLabel(text: string): void {
    if (!this.label || text === this.labelText) return;
    this.labelText = text;
    this.label.setText(text);
  }

  /** Raises the nameplate by `px` (it clears a carried item, M3-6). */
  setLabelLift(px: number): void {
    this.labelLift = px;
  }

  /** Half-transparent while the player is inside the reconnect window. */
  setConnected(connected: boolean): void {
    this.connectedAlpha = connected ? 1 : renderConfig.disconnectedAlpha;
    this.applyAlpha();
  }

  /** KO (lying down, faded), spawn-protection blink and the white hit flash (M4-2). Cheap every frame. */
  setCombatLook(look: CombatLook): void {
    const prev = this.combat;
    this.combat = look;
    if (prev.angle !== look.angle) {
      this.body.setAngle(look.angle);
      this.hat.setAngle(look.angle);
    }
    if (prev.flash !== look.flash) {
      if (look.flash) this.body.setTintFill(0xffffff);
      else this.body.setTint(this.tint);
    }
    if (prev.alpha !== look.alpha) this.applyAlpha();
  }

  /** Shows the Wanted ❗ over the head (synced PlayerState.wanted). Cheap every patch. */
  setWanted(wanted: boolean): void {
    if (wanted === this.wanted) return;
    this.wanted = wanted;
    if (wanted && !this.wantedIcon) {
      this.wantedIcon = this.scene.add
        .text(0, 0, '!', {
          fontFamily: 'monospace',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#e53935',
          padding: { x: 3, y: 0 },
          resolution: renderConfig.cameraZoom * 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(this.depth.label + 0.1);
      if (this.last) this.placeWanted(this.last.x, this.last.y);
    }
    this.wantedIcon?.setVisible(wanted && this.visible);
  }

  /** The ❗ is on screen (debug hook). */
  get wantedShown(): boolean {
    return this.wantedIcon?.visible === true;
  }

  private placeWanted(x: number, y: number): void {
    if (!this.wantedIcon) return;
    // A slow bob so it catches the eye.
    const bob = Math.round(Math.sin(this.scene.time.now / 150));
    this.wantedIcon.setPosition(
      Math.round(x),
      Math.round(y - renderConfig.wantedIconOffsetY - this.labelLift + bob),
    );
  }

  private applyAlpha(): void {
    const alpha = this.connectedAlpha * this.combat.alpha;
    this.body.setAlpha(alpha);
    this.hat.setAlpha(alpha);
    this.label?.setAlpha(this.connectedAlpha);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.wantedIcon?.setVisible(visible && this.wanted);
    this.body.setVisible(visible);
    this.hat.setVisible(visible);
    this.label?.setVisible(visible);
  }

  /**
   * Moves the avatar. `move` is the input direction (local player); without it the direction and
   * walk cycle come from how far the avatar moved since the last frame (remote players).
   */
  place(x: number, y: number, move?: { x: number; y: number }): void {
    let dir = move;
    let walking = move !== undefined && (move.x !== 0 || move.y !== 0);
    if (!dir) {
      const dx = this.last ? x - this.last.x : 0;
      const dy = this.last ? y - this.last.y : 0;
      walking = Math.hypot(dx, dy) > WALK_EPSILON_PX;
      dir = walking ? { x: dx, y: dy } : { x: 0, y: 0 };
    }
    this.last = { x, y };
    this.facing = facingFromMove(dir, this.facing);
    this.body.play(animKey('body', walking, this.facing), true);

    // Lower on screen draws in front (§15.4 characters layer), staying between the map layers.
    const depth = this.depth.player + Math.max(0, Math.min(1, y / this.depth.mapHeight)) * 0.5;
    this.body.setPosition(x, y).setDepth(depth);
    this.hat.setPosition(x, y).setDepth(depth + 0.0001);
    // The hat shows the body's frame, so they never drift apart.
    this.hat.setFrame(this.body.frame.name);
    this.label?.setPosition(Math.round(x), Math.round(y - renderConfig.nameplateOffsetY - this.labelLift));
    this.placeWanted(x, y);
  }

  get currentFacing(): Facing {
    return this.facing;
  }

  destroy(): void {
    this.body.destroy();
    this.hat.destroy();
    this.label?.destroy();
    this.wantedIcon?.destroy();
  }
}
