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
import { createManifestAnimations, preloadManifestAssets } from '../game/assets';
import { isDebugEnabled } from '../game/debugFlag';
import { placeZoneLabels } from '../game/debugLayout';
import { animKey, facingFromMove, type Facing } from '../game/facing';
import { installHook, removeHook, type KekeHook } from '../game/hook';
import { rawMapFor } from '../game/mapSource';
import { renderConfig } from '../game/renderConfig';
import { findSpawn } from '../game/spawn';
import { t } from '../i18n';
import { InputManager } from '../input';
import { browserStorage, loadProfile } from '../profile/storage';

/** Draw order (§15.4): ground, walls, decor, characters, then `above` over them; debug on top. */
const DEPTH = { ground: 0, walls: 1, decor: 2, player: 10, above: 20, debug: 30 } as const;

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
    preloadManifestAssets(this);
  }

  create(): void {
    this.debug = isDebugEnabled(window.location.search);
    this.theme = getTheme(defaultThemeId);
    this.config = loadConfig();
    const raw = rawMapFor(this.theme);
    this.model = loadMap(raw, this.theme.assets.map);

    createManifestAnimations(this);
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

    // The local player wears the saved profile (§13.1); first-time players get the profile defaults.
    const { profile } = loadProfile(browserStorage(), this.config.nicknameMaxLength);
    const tint = Phaser.Display.Color.HexStringToColor(profile.color).color;
    this.playerBody = this.add
      .sprite(spawn.x, spawn.y, 'body')
      .setOrigin(0.5, renderConfig.playerOriginY)
      .setTint(tint)
      .setDepth(DEPTH.player);
    this.hat = this.add
      .sprite(spawn.x, spawn.y, `hat_${profile.hat}`)
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

    const zoneColor = new Map<string, number>();
    model.zones.forEach((zone, i) => {
      const color = Phaser.Display.Color.HSLToColor((0.12 + i * 0.381966) % 1, 0.75, 0.5).color;
      zoneColor.set(zone.id, color);
      const points = zone.polygon.map((p) => new Phaser.Math.Vector2(p.x, p.y));
      g.fillStyle(color, renderConfig.debugZoneAlpha);
      g.fillPoints(points, true);
      g.lineStyle(1, color, 1);
      g.strokePoints(points, true);
    });
    for (const label of placeZoneLabels(model.zones)) {
      this.debugLabel(label.x, label.y, label.id, zoneColor.get(label.id) ?? 0xffffff);
    }

    // Forklift routes loop back from the last point to the first.
    for (const route of model.forkliftRoutes) {
      const points = route.points.map((p) => new Phaser.Math.Vector2(p.x, p.y));
      g.lineStyle(2, 0xffa500, 1);
      g.strokePoints(points, true);
      for (const p of route.points) g.fillStyle(0xffa500, 1).fillRect(p.x - 3, p.y - 3, 6, 6);
      const start = route.points[0];
      // Above the point: route starts often sit on a waypoint, whose label goes below.
      if (start) this.debugLabel(start.x, start.y - 6, `forklift ${route.name || route.id}`, 0xffa500, 1);
    }

    for (const wp of model.npcWaypoints) {
      g.lineStyle(1, 0x00ffff, 1);
      g.lineBetween(wp.x - 4, wp.y - 4, wp.x + 4, wp.y + 4);
      g.lineBetween(wp.x - 4, wp.y + 4, wp.x + 4, wp.y - 4);
      this.debugLabel(wp.x, wp.y + 5, wp.name || String(wp.id), 0x00ffff);
    }

    for (const npc of model.npcSpawns) {
      g.fillStyle(0xff00ff, 1).fillCircle(npc.x, npc.y, 5);
      this.debugLabel(npc.x, npc.y + 6, npc.type, 0xff00ff);
    }

    // Item spawns: dots in their zone's colour, outlined so they show on top of the zone fill.
    for (const spawn of model.itemSpawns) {
      g.fillStyle(zoneColor.get(spawn.zone) ?? 0xffffff, 1).fillCircle(spawn.x, spawn.y, 3);
      g.lineStyle(1, 0x000000, 1).strokeCircle(spawn.x, spawn.y, 3);
    }

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

  /** `originY` 0 hangs the label below (x, y), 1 puts it above. */
  private debugLabel(x: number, y: number, text: string, color: number, originY = 0): void {
    this.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: Phaser.Display.Color.IntegerToColor(color).rgba,
        backgroundColor: 'rgba(0,0,0,0.5)',
      })
      .setOrigin(0.5, originY)
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
