// Draws the round's items and vans (M3-6, §3.1, §10.1, §11.1): items lying in the world (targets with
// an owner-colour outline), items carried above their carrier's head, the joke-item twinkle, and the
// painted vans on the loading dock with a parking bay in the owner's (or team's) colour.
// The Game scene feeds it the synced state on each patch (sync) and the drawn positions each frame (draw).
import { getItemCatalogue, type ItemCatalogue, type MapModel, type ThemeId, type Vec2 } from '@keke/shared';
import Phaser from 'phaser';
import type { WorldItemView, WorldVanView, WorldView } from '../net/worldView';
import type { KekeItemSnapshot, KekeVanSnapshot } from './hookTypes';
import { renderConfig } from './renderConfig';
import {
  carriedItemCentreY,
  itemOutlineColor,
  nameplateLift,
  twinkle,
  vanFrame,
  vanOutlineColor,
  type OutlinePlayer,
} from './worldLayout';

export interface WorldDepths {
  /** Parking bays and vans, over the floor and decor. */
  van: number;
  /** Items lying on the floor, under every character. */
  item: number;
  /** Items carried above a head, over every character. */
  carried: number;
}

const ITEMS_ATLAS = 'items';
const VAN_ATLAS = 'van';
const SPARKLE_KEY = 'keke_sparkle';
/** The 4 outline copies of an item sprite: left, right, up, down. */
const OUTLINE_DIRS: readonly Vec2[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

const toColor = (hex: string): number =>
  /^#[0-9a-f]{6}$/i.test(hex) ? Phaser.Display.Color.HexStringToColor(hex).color : 0xffffff;

/** One item: the icon, four tint-filled copies behind it as the outline, and a twinkle for jokes. */
class ItemSprite {
  readonly main: Phaser.GameObjects.Image;
  private readonly copies: Phaser.GameObjects.Image[];
  private readonly sparkle: Phaser.GameObjects.Image | null;
  private outlineColor: string | undefined;

  constructor(
    scene: Phaser.Scene,
    frame: string,
    readonly joke: boolean,
  ) {
    this.copies = OUTLINE_DIRS.map(() => scene.add.image(0, 0, ITEMS_ATLAS, frame).setVisible(false));
    this.main = scene.add.image(0, 0, ITEMS_ATLAS, frame);
    this.sparkle = joke ? scene.add.image(0, 0, SPARKLE_KEY).setAlpha(0) : null;
  }

  get height(): number {
    return this.main.height;
  }

  /** Current outline colour, or undefined for none. */
  get outline(): string | undefined {
    return this.outlineColor;
  }

  setOutline(color: string | undefined): void {
    if (color === this.outlineColor) return;
    this.outlineColor = color;
    for (const copy of this.copies) {
      if (color === undefined) copy.setVisible(false);
      else copy.setTintFill(toColor(color)).setVisible(true);
    }
  }

  place(x: number, y: number, depth: number, timeSeconds: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    const w = renderConfig.itemOutlinePx;
    this.copies.forEach((copy, i) => {
      const dir = OUTLINE_DIRS[i] ?? { x: 0, y: 0 };
      copy.setPosition(px + dir.x * w, py + dir.y * w).setDepth(depth);
    });
    this.main.setPosition(px, py).setDepth(depth + 0.001);
    if (this.sparkle) {
      // Top-right corner of the icon, flashing once per period.
      this.sparkle
        .setPosition(px + this.main.width / 2 - 3, py - this.main.height / 2 + 3)
        .setDepth(depth + 0.002)
        .setAlpha(twinkle(timeSeconds, renderConfig.jokeTwinkleSeconds));
    }
  }

  destroy(): void {
    for (const copy of this.copies) copy.destroy();
    this.main.destroy();
    this.sparkle?.destroy();
  }
}

interface DrawnVan {
  view: WorldVanView;
  slot: Vec2 & { index: number };
  sprite: Phaser.GameObjects.Image;
  bay: Phaser.GameObjects.Graphics;
  outline: string | undefined;
  /** Colour the bay was last painted in ('' = none), null before the first paint. */
  painted: string | null;
}

export class WorldRenderer {
  private readonly catalogue: ItemCatalogue;
  private items = new Map<number, { view: WorldItemView; sprite: ItemSprite; x: number; y: number }>();
  private vans = new Map<number, DrawnVan>();
  /** Session id → frame height of the item they carry. */
  private carried = new Map<string, number>();
  private warned = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly model: MapModel,
    theme: ThemeId,
    private readonly depth: WorldDepths,
  ) {
    this.catalogue = getItemCatalogue(theme);
    if (!scene.textures.exists(SPARKLE_KEY)) {
      // A small four-point star (§10.1 sparkle), generated once per game.
      const g = scene.make.graphics({}, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(3, 0, 1, 7).fillRect(0, 3, 7, 1).fillRect(2, 2, 3, 3);
      g.generateTexture(SPARKLE_KEY, 7, 7);
      g.destroy();
    }
  }

  /**
   * Applies a state patch: creates, updates and removes item sprites and vans. `players` gives the
   * colours (lobby roster); `world` the items, vans and who carries what.
   */
  sync(world: WorldView, players: readonly OutlinePlayer[]): void {
    const roster = new Map(players.map((p) => [p.id, p]));

    const seen = new Set<number>();
    for (const view of world.items) {
      const frame = this.catalogue.get(view.itemId)?.sprite;
      if (frame === undefined || !this.scene.textures.get(ITEMS_ATLAS).has(frame)) {
        this.warnOnce(`item ${view.itemId} has no sprite`);
        continue;
      }
      seen.add(view.id);
      let drawn = this.items.get(view.id);
      if (drawn && drawn.sprite.main.frame.name !== frame) {
        drawn.sprite.destroy();
        drawn = undefined;
      }
      if (!drawn) {
        drawn = {
          view,
          sprite: new ItemSprite(this.scene, frame, view.rarity === 'joke'),
          x: view.x,
          y: view.y,
        };
        this.items.set(view.id, drawn);
      }
      drawn.view = view;
      drawn.sprite.setOutline(itemOutlineColor(view, roster, world.teams));
    }
    for (const [id, drawn] of this.items) {
      if (seen.has(id)) continue;
      drawn.sprite.destroy();
      this.items.delete(id);
    }

    this.carried.clear();
    for (const { view, sprite } of this.items.values()) {
      if (view.state === 'carried' && view.carrier !== '') this.carried.set(view.carrier, sprite.height);
    }

    this.syncVans(world.vans, (van) => vanOutlineColor(van, world, players));
  }

  /** Offline walk (`?scene=game`): the local player's van in slot 1, framed in their colour. */
  showOfflineVan(color: string): void {
    this.syncVans([{ van: 0, points: 0, team: 0 }], () => color);
  }

  /**
   * Every frame: puts lying items where the server says and carried ones above the carrier as drawn
   * (`positionOf` gives the drawn body of a session id; undefined falls back to the server position).
   */
  draw(positionOf: (sessionId: string) => Vec2 | undefined, timeSeconds: number): void {
    for (const drawn of this.items.values()) {
      const { view, sprite } = drawn;
      if (view.state === 'carried') {
        const at = positionOf(view.carrier) ?? view;
        drawn.x = at.x;
        drawn.y = carriedItemCentreY(at.y, sprite.height, renderConfig.carriedItemGapPx);
        sprite.place(drawn.x, drawn.y, this.depth.carried, timeSeconds);
      } else {
        drawn.x = view.x;
        drawn.y = view.y;
        sprite.place(drawn.x, drawn.y, this.depth.item, timeSeconds);
      }
    }
  }

  /** How far to raise `sessionId`'s nameplate so it clears the item they carry (0 if none). */
  nameplateLift(sessionId: string): number {
    const height = this.carried.get(sessionId);
    return height === undefined
      ? 0
      : nameplateLift(height, renderConfig.carriedItemGapPx, renderConfig.nameplateOffsetY);
  }

  itemSnapshots(): KekeItemSnapshot[] {
    return [...this.items.values()].map(({ view, sprite, x, y }) => ({
      id: view.id,
      itemId: view.itemId,
      name: this.catalogue.get(view.itemId)?.name ?? view.itemId,
      rarity: view.rarity,
      state: view.state,
      x,
      y,
      serverX: view.x,
      serverY: view.y,
      owner: view.owner,
      carrier: view.carrier,
      frame: String(sprite.main.frame.name),
      outline: sprite.outline ?? null,
    }));
  }

  vanSnapshots(): KekeVanSnapshot[] {
    return [...this.vans.values()].map(({ view, slot, sprite, outline }) => ({
      van: view.van,
      index: slot.index,
      x: slot.x,
      y: slot.y,
      points: view.points,
      team: view.team,
      frame: String(sprite.frame.name),
      outline: outline ?? null,
    }));
  }

  destroy(): void {
    for (const { sprite } of this.items.values()) sprite.destroy();
    this.items.clear();
    for (const van of this.vans.values()) {
      van.sprite.destroy();
      van.bay.destroy();
    }
    this.vans.clear();
    this.carried.clear();
  }

  private syncVans(vans: readonly WorldVanView[], colorOf: (van: WorldVanView) => string | undefined): void {
    const seen = new Set<number>();
    for (const view of vans) {
      const slot = this.model.vanSlots[view.van];
      const frame = vanFrame(view.van);
      if (!slot || !this.scene.textures.get(VAN_ATLAS).has(frame)) {
        this.warnOnce(`van ${view.van} has no slot or frame`);
        continue;
      }
      seen.add(view.van);
      let drawn = this.vans.get(view.van);
      if (!drawn) {
        const bay = this.scene.add.graphics().setDepth(this.depth.van);
        const sprite = this.scene.add
          .image(slot.x, slot.y, VAN_ATLAS, frame)
          .setDepth(this.depth.van + 0.001);
        drawn = { view, slot, sprite, bay, outline: undefined, painted: null };
        this.vans.set(view.van, drawn);
      }
      drawn.view = view;
      drawn.outline = colorOf(view);
      this.paintBay(drawn);
    }
    for (const [van, drawn] of this.vans) {
      if (seen.has(van)) continue;
      drawn.sprite.destroy();
      drawn.bay.destroy();
      this.vans.delete(van);
    }
  }

  /** Parking-bay lines on the ground around the van, in the owner's colour. */
  private paintBay(drawn: DrawnVan): void {
    const color = drawn.outline ?? '';
    if (drawn.painted === color) return;
    drawn.painted = color;
    drawn.bay.clear();
    if (color === '') return;
    const w = renderConfig.vanOutlinePx;
    const { width, height } = drawn.sprite;
    drawn.bay
      .lineStyle(w, toColor(color), 1)
      .strokeRect(drawn.slot.x - width / 2 - w, drawn.slot.y - height / 2 - w, width + 2 * w, height + 2 * w);
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(`[world] ${message}`);
  }
}
