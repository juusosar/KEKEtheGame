import {
  TILE_LAYERS,
  defaultThemeId,
  getTheme,
  loadConfig,
  loadMap,
  playerHalfSize,
  step,
  aabbOverlapsSolid,
  type GameConfig,
  type MapModel,
  type MapTheme,
  type MovementState,
} from '@keke/shared';
import Phaser from 'phaser';
import { isDebugEnabled } from '../game/debugFlag';
import { animKey, facingFromMove, type Facing } from '../game/facing';
import { installHook, removeHook, type KekeHook } from '../game/hook';
import type { AssetManifest } from '../game/manifest';
import { rawMapFor } from '../game/mapSource';
import { renderConfig } from '../game/renderConfig';
import { findSpawn } from '../game/spawn';
import { t } from '../i18n';
import { InputManager } from '../input';

/** Draw order (§15.4): ground, walls, decor, characters, then `above` over them; debug on top. */
const DEPTH = { ground: 0, walls: 1, decor: 2, player: 10, above: 20, debug: 30 } as const;

const MANIFEST_KEY = 'manifest';

/**
 * M1 game scene: one local player walking the map. Movement runs through the shared rules
 * (`step()`), exactly what the server will run from M2, so prediction can reuse it unchanged.
 * `?debug=1` adds the zone/collision overlay and the `window.__KEKE__` test hook.
 */
export class GameScene extends Phaser.Scene {
  private theme!: MapTheme;
  private model!: MapModel;
  private config!: GameConfig;
  private inputManager!: InputManager;
  private playerBody!: Phaser.GameObjects.Sprite;
  private hat!: Phaser.GameObjects.Sprite;
  private state: MovementState = { x: 0, y: 0, vx: 0, vy: 0 };
  private facing: Facing = 'down';
  private debug = false;
  private hitbox?: Phaser.GameObjects.Rectangle;
  private readout?: HTMLElement;
  private hook?: KekeHook;

  constructor() {
    super('Game');
  }

  preload(): void {
    this.load.setPath('assets/');
    this.load.json(MANIFEST_KEY, 'manifest.json');
    // Everything else is listed in the manifest, so queue it once the manifest itself has arrived.
    this.load.once(
      `filecomplete-json-${MANIFEST_KEY}`,
      (_key: string, _type: string, data: AssetManifest) => {
        for (const atlas of data.atlases) this.load.atlas(atlas.key, atlas.texture, atlas.atlas);
        for (const tileset of data.tilesets) this.load.image(tileset.key, tileset.image);
      },
    );
  }

  create(): void {
    this.debug = isDebugEnabled(window.location.search);
    this.theme = getTheme(defaultThemeId);
    this.config = loadConfig();
    const raw = rawMapFor(this.theme);
    this.model = loadMap(raw, this.theme.assets.map);

    this.createAnimations(this.cache.json.get(MANIFEST_KEY) as AssetManifest);
    this.createTilemap(raw);
    this.createPlayer();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.model.widthPx, this.model.heightPx);
    cam.setZoom(renderConfig.cameraZoom);
    cam.setRoundPixels(true);
    cam.startFollow(this.playerBody, true, renderConfig.cameraLerp, renderConfig.cameraLerp);

    this.inputManager = new InputManager(this);

    if (this.debug) this.createDebug();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardownDebug());
    document.body.dataset['scene'] = 'game';
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, renderConfig.maxFrameSeconds);
    this.inputManager.setOrigin(this.state);
    const frame = this.inputManager.sample();
    this.state = step(this.state, frame, dt, this.model, this.config);

    const walking = frame.move.x !== 0 || frame.move.y !== 0;
    this.facing = facingFromMove(frame.move, this.facing);
    this.playerBody.play(animKey('body', walking, this.facing), true);
    this.placePlayer();

    if (this.debug) this.updateDebug();
  }

  private createAnimations(manifest: AssetManifest): void {
    for (const anim of manifest.animations) {
      if (this.anims.exists(anim.key)) continue;
      this.anims.create({
        key: anim.key,
        frames: anim.frames.map((frame) => ({ key: anim.atlas, frame })),
        frameRate: anim.frameRate,
        repeat: anim.repeat,
      });
    }
  }

  private createTilemap(raw: unknown): void {
    const key = `map:${this.theme.id}`;
    if (!this.cache.tilemap.exists(key)) {
      this.cache.tilemap.add(key, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: raw });
    }
    const map = this.make.tilemap({ key });
    // Embedded tilesets are named after their texture key in the asset manifest (e.g. `kespro_tiles`).
    const tilesets = map.tilesets.map((ts) => {
      const tileset = map.addTilesetImage(ts.name, ts.name);
      if (!tileset) throw new Error(`tileset ${ts.name} has no loaded texture`);
      return tileset;
    });
    for (const name of TILE_LAYERS) {
      const layer = map.createLayer(name, tilesets, 0, 0);
      if (!layer) throw new Error(`map layer ${name} could not be created`);
      layer.setDepth(DEPTH[name]);
    }
  }

  private createPlayer(): void {
    const slot = this.model.vanSlots[0];
    const preferred = slot ?? { x: this.model.widthPx / 2, y: this.model.heightPx / 2 };
    const spawn = findSpawn(this.model.collision, preferred, playerHalfSize(this.config));
    this.state = { x: spawn.x, y: spawn.y, vx: 0, vy: 0 };

    const tint = Phaser.Display.Color.HexStringToColor(renderConfig.defaultPlayerColor).color;
    this.playerBody = this.add
      .sprite(spawn.x, spawn.y, 'body')
      .setOrigin(0.5, renderConfig.playerOriginY)
      .setTint(tint)
      .setDepth(DEPTH.player);
    this.hat = this.add
      .sprite(spawn.x, spawn.y, `hat_${renderConfig.defaultHat}`)
      .setOrigin(0.5, renderConfig.playerOriginY)
      .setDepth(DEPTH.player + 0.5);
    this.playerBody.play(animKey('body', false, this.facing));
    this.placePlayer();
  }

  /** Puts body and hat on the simulated position. The hat shows the body's frame, so they never drift apart. */
  private placePlayer(): void {
    this.playerBody.setPosition(this.state.x, this.state.y);
    this.hat.setPosition(this.state.x, this.state.y);
    this.hat.setFrame(this.playerBody.frame.name);
  }

  // --- ?debug=1 -------------------------------------------------------------------------------------

  private createDebug(): void {
    const { model } = this;
    const ts = model.tileSize;
    const g = this.add.graphics().setDepth(DEPTH.debug);

    g.fillStyle(0xff0000, renderConfig.debugWallAlpha);
    for (let ty = 0; ty < model.height; ty++) {
      for (let tx = 0; tx < model.width; tx++) {
        if (model.collision.isSolid(tx, ty)) g.fillRect(tx * ts, ty * ts, ts, ts);
      }
    }

    model.zones.forEach((zone, i) => {
      const color = Phaser.Display.Color.HSLToColor((0.12 + i * 0.381966) % 1, 0.75, 0.5).color;
      const points = zone.polygon.map((p) => new Phaser.Math.Vector2(p.x, p.y));
      g.fillStyle(color, renderConfig.debugZoneAlpha);
      g.fillPoints(points, true);
      g.lineStyle(1, color, 1);
      g.strokePoints(points, true);
      this.debugLabel((zone.bounds.minX + zone.bounds.maxX) / 2, zone.bounds.minY + 4, zone.id, color);
    });

    g.lineStyle(1, 0xffffff, 1);
    g.strokePoints(
      model.officeTrigger.polygon.map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
    );
    for (const slot of model.vanSlots) {
      g.strokeCircle(slot.x, slot.y, 6);
      this.debugLabel(slot.x, slot.y + 8, String(slot.index), 0xffffff);
    }

    const size = this.config.playerHitboxSize;
    this.hitbox = this.add
      .rectangle(this.state.x, this.state.y, size, size)
      .setStrokeStyle(1, 0x00ff00)
      .setDepth(DEPTH.debug + 1);

    this.readout = document.createElement('pre');
    this.readout.id = 'keke-debug';
    Object.assign(this.readout.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      margin: '0',
      padding: '4px 8px',
      font: '12px monospace',
      color: '#fff',
      background: 'rgba(0,0,0,0.6)',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.readout);

    const hook: KekeHook = {
      scene: this.scene.key,
      map: {
        theme: this.theme.id,
        widthPx: model.widthPx,
        heightPx: model.heightPx,
        tileSize: model.tileSize,
      },
      player: () => ({
        x: this.state.x,
        y: this.state.y,
        vx: this.state.vx,
        vy: this.state.vy,
        facing: this.facing,
        zone: model.zoneAt(this.state.x, this.state.y)?.id ?? null,
      }),
      teleport: (x, y) => {
        if (aabbOverlapsSolid(model.collision, { x, y }, playerHalfSize(this.config))) return false;
        this.state = { x, y, vx: 0, vy: 0 };
        this.placePlayer();
        this.cameras.main.centerOn(x, y);
        return true;
      },
      zoneAt: (x, y) => model.zoneAt(x, y)?.id ?? null,
    };
    this.hook = hook;
    installHook(hook);
  }

  private debugLabel(x: number, y: number, text: string, color: number): void {
    this.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: Phaser.Display.Color.IntegerToColor(color).rgba,
        backgroundColor: 'rgba(0,0,0,0.5)',
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.debug + 1);
  }

  private updateDebug(): void {
    this.hitbox?.setPosition(this.state.x, this.state.y);
    if (this.readout) {
      this.readout.textContent = t('debug.readout', {
        x: Math.round(this.state.x),
        y: Math.round(this.state.y),
        zone: this.model.zoneAt(this.state.x, this.state.y)?.id ?? '-',
        device: this.inputManager.device,
        fps: Math.round(this.game.loop.actualFps),
      });
    }
  }

  private teardownDebug(): void {
    this.readout?.remove();
    if (this.hook) removeHook(this.hook);
    delete document.body.dataset['scene'];
  }
}
