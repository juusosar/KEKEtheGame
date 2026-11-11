// Pushable shopping carts (P2-5): one sprite per cart from the theme's `cart` sheet (frames
// `cart_down|up|left|right`, P1-2), drawn where prediction puts it (the server's cart with our pending
// pushes), eased so the 20 Hz patches of other players' pushes and rolls do not show as jumps. A cart that
// starts moving rattles. Without the atlas (tests) a Graphics box stands in.
import type Phaser from 'phaser';
import type { CartDir } from '@keke/shared';

/** What the renderer needs of a cart. */
export interface CartLook {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly dir: CartDir;
}

/** Fraction of the gap to the true position closed per second (exponential easing). */
const EASE_PER_SECOND = 18;
/** Further than this the drawn cart snaps (new round, teleport-like corrections). */
const SNAP_PX = 64;
/** A cart counts as moving when it went at least this far in a frame (px). */
const MOVING_PX = 0.5;
/** A cart at rest this long rattles again when it next moves (seconds). */
const RATTLE_REST_SECONDS = 0.4;

interface Drawn {
  x: number;
  y: number;
  dir: CartDir;
  sprite: Phaser.GameObjects.Sprite | null;
  /** Seconds since it last moved. */
  rest: number;
}

export class CartRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly drawn = new Map<number, Drawn>();

  constructor(
    private readonly scene: Phaser.Scene,
    /** Texture key of the theme's cart sheet (`themeAtlasKey(manifest, mapId, 'cart')`). */
    private readonly atlas: string,
    private readonly depth: { player: number; mapHeight: number },
    private readonly size: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth.player);
  }

  /**
   * Moves the drawn carts towards `carts` for a frame of `dt` seconds. Returns the carts that started
   * moving this frame after resting (for the rattle).
   */
  update(carts: readonly CartLook[], dt: number): CartLook[] {
    const started: CartLook[] = [];
    const seen = new Set<number>();
    const k = 1 - Math.exp(-EASE_PER_SECOND * Math.max(0, dt));
    const hasAtlas = this.scene.textures.exists(this.atlas);
    this.g.clear();
    for (const cart of carts) {
      seen.add(cart.id);
      let d = this.drawn.get(cart.id);
      if (!d) {
        d = { x: cart.x, y: cart.y, dir: cart.dir, sprite: null, rest: RATTLE_REST_SECONDS };
        this.drawn.set(cart.id, d);
      }
      const far = Math.hypot(cart.x - d.x, cart.y - d.y) > SNAP_PX;
      const nx = far ? cart.x : d.x + (cart.x - d.x) * k;
      const ny = far ? cart.y : d.y + (cart.y - d.y) * k;
      const step = Math.hypot(nx - d.x, ny - d.y);
      if (!far && step >= MOVING_PX) {
        if (d.rest >= RATTLE_REST_SECONDS) started.push(cart);
        d.rest = 0;
      } else {
        d.rest += Math.max(0, dt);
      }
      d.x = nx;
      d.y = ny;
      d.dir = cart.dir;
      const depth = this.depth.player + Math.max(0, Math.min(1, ny / this.depth.mapHeight)) * 0.5;
      const frame = `cart_${cart.dir}`;
      if (hasAtlas && this.scene.textures.get(this.atlas).has(frame)) {
        d.sprite ??= this.scene.add.sprite(nx, ny, this.atlas, frame);
        d.sprite.setPosition(nx, ny).setFrame(frame).setDepth(depth);
        continue;
      }
      const h = this.size / 2;
      this.g.fillStyle(0x9aa3ad, 1).fillRect(nx - h, ny - h, this.size, this.size);
      this.g.lineStyle(1, 0x4a525c, 1).strokeRect(nx - h, ny - h, this.size, this.size);
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      d.sprite?.destroy();
      this.drawn.delete(id);
    }
    return started;
  }

  /** Where each cart is drawn (debug hook). */
  snapshots(): CartLook[] {
    return [...this.drawn].map(([id, d]) => ({ id, x: d.x, y: d.y, dir: d.dir }));
  }

  destroy(): void {
    this.g.destroy();
    for (const d of this.drawn.values()) d.sprite?.destroy();
    this.drawn.clear();
  }
}
