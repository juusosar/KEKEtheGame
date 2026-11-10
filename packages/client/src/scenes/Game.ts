import type { Room } from '@colyseus/sdk';
import {
  ClientMessage,
  CombatEventMessage,
  DebugMessage,
  TILE_LAYERS,
  aabbOverlapsSolid,
  defaultThemeId,
  getItemCatalogue,
  getWeaponCatalogue,
  getTheme,
  inputStepSeconds,
  loadConfig,
  loadMap,
  playerHalfSize,
  vanSpawn,
  type GameConfig,
  type MapModel,
  type MapTheme,
  type Vec2,
} from '@keke/shared';
import Phaser from 'phaser';
import { createManifestAnimations, preloadManifestAssets } from '../game/assets';
import { Avatar } from '../game/avatar';
import { CombatFx } from '../game/combatFx';
import { SprayFx } from '../game/sprayFx';
import { isDebugEnabled } from '../game/debugFlag';
import { placeZoneLabels } from '../game/debugLayout';
import { installHook, removeHook, type KekeHook } from '../game/hook';
import type { KekeCombatSnapshot, KekeNetSnapshot, KekeRemoteSnapshot } from '../game/hookTypes';
import { rawMapFor } from '../game/mapSource';
import { renderConfig } from '../game/renderConfig';
import { SpectatorCycle, spectateCandidates } from '../game/spectate';
import { PeelRenderer } from '../game/peels';
import { WorldRenderer } from '../game/worldItems';
import { ProjectileRenderer } from '../game/projectiles';
import { Hud } from '../hud/Hud';
import { FEED_MESSAGES, feedLine } from '../hud/feed';
import { readHud, type HudContext } from '../hud/hudState';
import { RoundScreen } from '../hud/RoundScreen';
import { readRoundScreen } from '../hud/roundScreens';
import { t } from '../i18n';
import { InputManager, STANDARD } from '../input';
import { DEFAULT_COMBAT, predictionSpeed, readCombat, type CombatPlayerView } from '../net/combatView';
import { SnapshotBuffer } from '../net/interpolation';
import { isControlling, isOnMap, readGame, sceneForPhase, type GameView } from '../net/gameView';
import { FixedStepClock, Predictor, inputSequenceFor, type InputSequence } from '../net/prediction';
import { ROOM_CODE_REGISTRY_KEY, currentRoom, setCurrentRoom } from '../net/session';
import { readTraps } from '../net/trapView';
import { readWorld, type WorldView } from '../net/worldView';
import { readProjectiles } from '../net/projectileView';
import { browserStorage, loadProfile } from '../profile/storage';
import { MinimapView } from '../render/MinimapView';
import { buildMinimapMarkers, offlineMinimapWorld, readMinimapWorld, withSelfAt } from '../render/minimap';
import type { PlaySceneData } from './Lobby';

/** Draw order (§15.4): ground, walls, decor, characters, then `above` over them; nameplates; debug on top. */
const DEPTH = { ground: 0, walls: 1, decor: 2, player: 10, fx: 15, above: 20, label: 25, debug: 30 } as const;

interface Remote {
  avatar: Avatar;
  buffer: SnapshotBuffer;
}

/**
 * The game scene. In a room (M2-3) the server owns every position: the local player is predicted
 * with the shared rules one fixed input step at a time and reconciled against the server's acks,
 * and everyone else is drawn ~100 ms in the past between state patches. Without a room
 * (`?scene=game`) it is the M1 offline walk: the same fixed-step prediction, with nothing to reconcile.
 * Late joiners spectate: the camera cycles between players, click or pad A skips to the next.
 * `?debug=1` adds the zone/collision overlay and the `window.__KEKE__` test hook.
 */
export class GameScene extends Phaser.Scene {
  private theme!: MapTheme;
  private model!: MapModel;
  private config!: GameConfig;
  private inputManager!: InputManager;
  private local!: Avatar;
  private predictor!: Predictor;
  private clock!: FixedStepClock;
  private lastMove: Vec2 = { x: 0, y: 0 };
  private minimap: MinimapView | undefined;
  /** Profile colour, for the offline minimap. */
  private profileColor = '';
  /** Items and vans (M3-6). */
  private world!: WorldRenderer;

  // Online only.
  private room: Room | null = null;
  private code = '';
  private sequence: InputSequence | null = null;
  private view: GameView | null = null;
  private worldView: WorldView | null = null;
  private controlling = false;
  private remotes = new Map<string, Remote>();
  private spectatorCycle = new SpectatorCycle(renderConfig.spectatorCycleSeconds);
  private spectating: string | null = null;
  private spectateBanner: HTMLElement | undefined;
  private leaving = false;
  private unsubscribe: (() => void)[] = [];
  private hud: Hud | undefined;
  /** Round intro / results / podium panels (§13.1); online only. */
  private roundScreen: RoundScreen | undefined;
  private hudContext!: HudContext;
  private icons = new Map<string, string | null>();
  /** Swings, hit flashes, stun rings and HP bars (M4-2); online only. */
  private combatFx: CombatFx | undefined;
  private sprayFx: SprayFx | undefined;
  private projectiles: ProjectileRenderer | undefined;
  private combat = new Map<string, CombatPlayerView>();
  /** Banana peels on the floor (M4-5); online only. */
  private peels: PeelRenderer | undefined;

  private debug = false;
  private hitbox?: Phaser.GameObjects.Rectangle;
  private readout: HTMLElement | undefined;
  private hook: KekeHook | undefined;

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
    this.resetFields();

    const current = currentRoom();
    this.room = current?.room ?? null;
    this.code = current?.code ?? '';

    createManifestAnimations(this);
    this.createTilemap(raw);
    const profile = this.createLocalPlayer();
    this.createWorld(profile.color);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.model.widthPx, this.model.heightPx);
    cam.setZoom(renderConfig.cameraZoom);
    cam.setRoundPixels(true);
    cam.startFollow(this.local.body, true, renderConfig.cameraLerp, renderConfig.cameraLerp);

    this.minimap = new MinimapView(this.model, this.theme);
    this.inputManager = new InputManager(this);
    this.clock = new FixedStepClock(inputStepSeconds(this.config));

    if (this.debug) this.createDebug();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    document.body.dataset['scene'] = 'game';

    if (this.room !== null) this.joinRoom(this.room);
  }

  override update(time: number, deltaMs: number): void {
    if (this.leaving) return;
    const dt = Math.min(deltaMs / 1000, renderConfig.maxFrameSeconds);
    const offline = this.room === null;

    const steps = this.clock.advance(dt);
    for (let i = 0; i < steps; i++) {
      if (!offline && !this.controlling) break;
      this.inputManager.setOrigin(this.predictor.state);
      const frame = this.inputManager.sample();
      this.lastMove = frame.move;
      if (offline) {
        this.predictor.apply(frame, false);
      } else if (this.room && this.sequence) {
        const sent = { ...frame, seq: this.sequence.next() };
        this.predictor.apply(sent);
        this.room.send(ClientMessage.input, sent);
      }
    }
    if (!offline && !this.controlling) this.lastMove = { x: 0, y: 0 };

    const pos = this.predictor.renderPosition(this.clock.alpha);
    this.local.place(pos.x, pos.y, this.lastMove);

    if (!offline) this.updateRemotes(dt);
    this.drawCombat(time / 1000);
    this.projectiles?.draw(time / 1000);
    this.updateMinimap(dt);
    this.world.draw((id) => this.drawnPosition(id), time / 1000);
    if (this.hud) this.updateHud(this.hud);
    if (this.debug) this.updateDebug();
  }

  /** Scene objects are reused between runs; fields that hold per-run state start fresh here. */
  private resetFields(): void {
    this.lastMove = { x: 0, y: 0 };
    this.room = null;
    this.code = '';
    this.sequence = null;
    this.view = null;
    this.worldView = null;
    this.controlling = false;
    this.remotes = new Map();
    this.spectatorCycle = new SpectatorCycle(renderConfig.spectatorCycleSeconds);
    this.spectating = null;
    this.leaving = false;
    this.unsubscribe = [];
    this.hud = undefined;
    this.roundScreen = undefined;
    this.icons = new Map();
    this.combatFx = undefined;
    this.sprayFx = undefined;
    this.peels = undefined;
    this.combat = new Map();
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

  private createLocalPlayer(): { color: string } {
    // Offline: van slot 1. In a room the first state patch moves us to the server's spawn.
    const spawn = vanSpawn(this.model, 0, playerHalfSize(this.config));
    const start = { x: spawn.x, y: spawn.y, vx: 0, vy: 0 };
    this.predictor = new Predictor(this.model, this.config, start);

    this.local = this.newAvatar(this.room !== null);
    // Offline (and in a room until the first patch) the local player wears the saved profile (§13.1).
    const { profile } = loadProfile(browserStorage(), this.config.nicknameMaxLength);
    this.local.setLook(profile);
    this.profileColor = profile.color;
    this.local.setLabel(profile.nickname);
    this.local.place(start.x, start.y, { x: 0, y: 0 });
    return profile;
  }

  private createWorld(offlineColor: string): void {
    this.world = new WorldRenderer(this, this.model, this.theme.id, {
      van: DEPTH.decor + 0.5,
      item: DEPTH.player - 0.5,
      carried: DEPTH.player + 0.6,
    });
    // Offline walk: our van in slot 1, where we start. In a room the state says which vans exist.
    if (this.room === null) this.world.showOfflineVan(offlineColor);
  }

  /** Items and vans from the synced state, plus nameplates lifted over carried items. */
  private syncWorld(state: unknown, view: GameView): void {
    const world = readWorld(state);
    this.worldView = world;
    this.world.sync(world, view.players);
    this.projectiles?.sync(readProjectiles(state), this.time.now / 1000);
    this.local.setLabelLift(this.world.nameplateLift(view.me?.id ?? ''));
    for (const [id, remote] of this.remotes) remote.avatar.setLabelLift(this.world.nameplateLift(id));
  }

  /** Where a player is drawn this frame (predicted for us, interpolated for others); undefined if not drawn. */
  private drawnPosition(sessionId: string): Vec2 | undefined {
    const body =
      sessionId === this.room?.sessionId ? this.local.body : this.remotes.get(sessionId)?.avatar.body;
    return body?.visible ? { x: body.x, y: body.y } : undefined;
  }

  private newAvatar(withLabel: boolean): Avatar {
    return new Avatar(
      this,
      { player: DEPTH.player, label: DEPTH.label, mapHeight: this.model.heightPx },
      withLabel,
    );
  }

  /** Minimap markers from the synced state (or the offline walk), with us at the predicted position. */
  private updateMinimap(dt: number): void {
    this.minimap?.update(dt, () => {
      const at = this.predictor.state;
      const room = this.room;
      const world =
        room === null
          ? offlineMinimapWorld(this.profileColor, at)
          : withSelfAt(readMinimapWorld(room.state, room.sessionId), at);
      return buildMinimapMarkers(world, this.model);
    });
  }

  // --- room -----------------------------------------------------------------------------------------

  private joinRoom(room: Room): void {
    this.sequence = inputSequenceFor(room, this.config.maxQueuedInputs);
    this.createHud(room);
    this.createCombatFx(room);
    this.projectiles = new ProjectileRenderer(this, DEPTH.fx);
    this.peels = new PeelRenderer(this, DEPTH.player - 0.6);
    this.roundScreen = new RoundScreen();
    // Hidden until the first patch says where we are (and whether we are in the round at all).
    this.local.setVisible(false);

    const onState = (): void => this.onPatch();
    const onLeave = (): void => this.lost();
    room.onStateChange(onState);
    room.onLeave(onLeave);
    this.unsubscribe.push(
      () => room.onStateChange.remove(onState),
      () => room.onLeave.remove(onLeave),
    );

    // Spectators skip to the next player on click or pad A (§13.1).
    const onPointer = (): void => this.skipSpectated();
    const onPad = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button): void => {
      if (button.index === STANDARD.buttons.a) this.skipSpectated();
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onPointer);
    this.input.gamepad?.on(Phaser.Input.Gamepad.Events.BUTTON_DOWN, onPad);
    this.unsubscribe.push(
      () => this.input.off(Phaser.Input.Events.POINTER_DOWN, onPointer),
      () => this.input.gamepad?.off(Phaser.Input.Gamepad.Events.BUTTON_DOWN, onPad),
    );

    this.onPatch();
  }

  /** Every state patch: reconcile our prediction, feed the remote buffers, follow phase changes. */
  private onPatch(): void {
    const room = this.room;
    if (room === null || this.leaving) return;
    const view = readGame(room.state, room.sessionId);
    if (!view.synced) return;
    this.view = view;
    // `<body data-phase>` lets CSS hide the in-round HUD behind the results and specs wait on phases.
    document.body.dataset['phase'] = view.phase;
    this.hud?.render(readHud(room.state, room.sessionId, this.hudContext));
    this.roundScreen?.render(readRoundScreen(room.state, room.sessionId));

    if (sceneForPhase(view.phase) !== 'Game') {
      // The session is over (podium → lobby): everyone goes back to the lobby.
      this.leaving = true;
      this.scene.start(sceneForPhase(view.phase));
      return;
    }

    const me = view.me;
    if (me === null) return;
    this.sequence?.sync(me.ack);
    this.local.setLook(me);
    this.local.setLabel(me.nickname);
    this.local.setVisible(isOnMap(me, view.phase));

    const controlling = isControlling(view);
    this.combat = readCombat(room.state);
    // Same carry, stun, slow and KO speed as the server, from synced state (M2 review H1).
    const myCombat = this.combat.get(me.id) ?? DEFAULT_COMBAT;
    this.predictor.setModifiers({
      speedMultiplier: predictionSpeed(myCombat, me.carrying !== 0, this.config, getWeaponCatalogue()),
    });
    if (controlling && this.controlling) {
      this.predictor.reconcile(me);
    } else {
      // Not simulated (countdown, results, spectating), or the round just started: take the server's body.
      this.predictor.reset(me);
      this.clock.reset();
    }
    this.controlling = controlling;

    const now = performance.now();
    const seen = new Set<string>();
    for (const p of view.players) {
      if (p.isMe || !isOnMap(p, view.phase)) continue;
      seen.add(p.id);
      let remote = this.remotes.get(p.id);
      if (!remote) {
        remote = {
          avatar: this.newAvatar(true),
          buffer: new SnapshotBuffer({
            delayMs: renderConfig.interpolationDelayMs,
            snapDistance: renderConfig.snapDistancePx,
            patchIntervalMs: 1000 / this.config.serverTickHz,
          }),
        };
        this.remotes.set(p.id, remote);
      }
      remote.buffer.push(now, p.x, p.y);
      remote.avatar.setLook(p);
      remote.avatar.setConnected(p.connected);
      remote.avatar.setLabel(p.connected ? p.nickname : t('game.reconnecting', { name: p.nickname }));
    }
    for (const [id, remote] of this.remotes) {
      if (seen.has(id)) continue;
      remote.avatar.destroy();
      this.remotes.delete(id);
    }
    this.syncWorld(room.state, view);
    this.peels?.sync(readTraps(room.state));
  }

  private updateRemotes(dt: number): void {
    const now = performance.now();
    for (const remote of this.remotes.values()) {
      const pos = remote.buffer.sample(now);
      if (pos) remote.avatar.place(pos.x, pos.y);
    }
    this.updateSpectator(dt);
  }

  // --- combat feedback (M4-2) --------------------------------------------------------------------------

  private createCombatFx(room: Room): void {
    const fx = new CombatFx(this, DEPTH.fx, getWeaponCatalogue(), this.config.maxHp);
    this.combatFx = fx;
    // Spray cones under the labels; vision clouds over everything in the world, nameplates too (M4-4).
    const spray = new SprayFx(this, DEPTH.fx, DEPTH.label + 1, getWeaponCatalogue(), renderConfig);
    this.sprayFx = spray;
    for (const type of Object.values(CombatEventMessage)) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          fx.onEvent(type, message, this.time.now / 1000);
          spray.onEvent(type, message, this.time.now / 1000);
        }),
      );
    }
  }

  /** Avatar looks (KO, protection, hit flash) and the world FX, from the last patch. */
  private drawCombat(now: number): void {
    const fx = this.combatFx;
    const room = this.room;
    if (!fx || room === null) return;
    const bodies: { pos: Vec2; combat: CombatPlayerView }[] = [];
    const add = (id: string, avatar: Avatar): void => {
      const combat = this.combat.get(id) ?? DEFAULT_COMBAT;
      avatar.setCombatLook(fx.lookFor(id, combat, now));
      if (avatar.body.visible) bodies.push({ pos: { x: avatar.body.x, y: avatar.body.y }, combat });
    };
    add(room.sessionId, this.local);
    for (const [id, remote] of this.remotes) add(id, remote.avatar);
    fx.draw(now, bodies);
    this.sprayFx?.draw(now, (id) => {
      const avatar = id === room.sessionId ? this.local : this.remotes.get(id)?.avatar;
      return avatar?.body.visible ? { x: avatar.body.x, y: avatar.body.y } : undefined;
    });
  }

  // --- HUD (§13.2) -----------------------------------------------------------------------------------

  /** Online only: the HUD shows round state, so `?scene=game` walk mode has none. */
  private createHud(room: Room): void {
    const catalogue = getItemCatalogue(this.theme.id);
    this.hudContext = { catalogue, vanSlots: this.model.vanSlots };
    const hud = new Hud({ iconFor: (sprite) => this.itemIcon(sprite) });
    this.hud = hud;
    const nameOf = (id: string): string => this.view?.players.find((p) => p.id === id)?.nickname ?? id;
    for (const type of FEED_MESSAGES) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          const line = feedLine(type, message, { catalogue, nameOf });
          if (line) hud.pushFeed(line, performance.now());
        }),
      );
    }
  }

  private updateHud(hud: Hud): void {
    hud.tick(performance.now());
    hud.setBoardOpen(this.inputManager.scoreboardHeld());
    const cam = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    const scaleX = this.scale.width > 0 ? rect.width / this.scale.width : 1;
    const scaleY = this.scale.height > 0 ? rect.height / this.scale.height : 1;
    hud.updateArrow(
      (world) => ({
        x: rect.left + ((world.x - cam.worldView.x) * cam.zoom + cam.x) * scaleX,
        y: rect.top + ((world.y - cam.worldView.y) * cam.zoom + cam.y) * scaleY,
      }),
      { width: hud.root.clientWidth, height: hud.root.clientHeight },
    );
  }

  /** Data URL of an `items` atlas frame for the HUD card and carry slot, cached per frame. */
  private itemIcon(sprite: string): string | null {
    const cached = this.icons.get(sprite);
    if (cached !== undefined) return cached;
    let url: string | null = null;
    if (this.textures.exists('items') && this.textures.get('items').has(sprite)) {
      url = this.textures.getBase64('items', sprite) || null;
    }
    this.icons.set(sprite, url);
    return url;
  }

  /** Late joiners watch the round: the camera cycles between the players in it (§13.1). */
  private updateSpectator(dt: number): void {
    const view = this.view;
    const watching = view?.me?.spectator === true;
    const cam = this.cameras.main;
    if (!watching || view === null) {
      if (this.spectating !== null || this.spectateBanner) {
        this.spectating = null;
        this.hideSpectateBanner();
        cam.startFollow(this.local.body, true, renderConfig.cameraLerp, renderConfig.cameraLerp);
      }
      return;
    }
    const target = this.spectatorCycle.update(this.candidates(), dt);
    if (target !== this.spectating) {
      this.spectating = target;
      const followed = target === null ? undefined : this.remotes.get(target);
      if (followed)
        cam.startFollow(followed.avatar.body, true, renderConfig.cameraLerp, renderConfig.cameraLerp);
      else cam.stopFollow();
    }
    const name = view.players.find((p) => p.id === target)?.nickname;
    this.showSpectateBanner(name === undefined ? t('game.spectatingNobody') : t('game.spectating', { name }));
  }

  private candidates(): string[] {
    const view = this.view;
    if (view === null || view.me === null) return [];
    return spectateCandidates(
      view.players.map((p) => ({ ...p, sessionId: p.id })),
      view.me.id,
    );
  }

  private skipSpectated(): void {
    if (this.view?.me?.spectator !== true) return;
    this.spectatorCycle.next(this.candidates());
    // updateSpectator picks up the new target on the next frame.
  }

  private showSpectateBanner(text: string): void {
    if (!this.spectateBanner) {
      const banner = document.createElement('div');
      banner.id = 'keke-spectate';
      banner.setAttribute('role', 'status');
      banner.className = 'spectate-banner';
      const title = document.createElement('strong');
      const hint = document.createElement('span');
      hint.textContent = t('game.spectateHint');
      banner.append(title, hint);
      document.body.appendChild(banner);
      this.spectateBanner = banner;
    }
    const title = this.spectateBanner.firstElementChild;
    if (title && title.textContent !== text) title.textContent = text;
    document.body.dataset['spectating'] = this.spectating ?? '';
  }

  private hideSpectateBanner(): void {
    this.spectateBanner?.remove();
    this.spectateBanner = undefined;
    delete document.body.dataset['spectating'];
  }

  /** The connection is gone for good (the SDK already tried to reconnect, or the server closed the room). */
  private lost(): void {
    if (this.leaving) return;
    this.leaving = true;
    setCurrentRoom(null);
    this.registry.remove(ROOM_CODE_REGISTRY_KEY);
    delete document.body.dataset['room'];
    const data: PlaySceneData = { notice: t('game.lost') };
    this.scene.start('Play', data);
  }

  private shutdown(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    for (const remote of this.remotes.values()) remote.avatar.destroy();
    this.remotes.clear();
    this.world.destroy();
    this.hideSpectateBanner();
    this.minimap?.destroy();
    this.minimap = undefined;
    this.hud?.destroy();
    this.hud = undefined;
    this.roundScreen?.destroy();
    this.roundScreen = undefined;
    this.combatFx?.destroy();
    this.combatFx = undefined;
    this.sprayFx?.destroy();
    this.sprayFx = undefined;
    this.projectiles?.destroy();
    this.projectiles = undefined;
    this.peels?.destroy();
    this.peels = undefined;
    this.teardownDebug();
    delete document.body.dataset['scene'];
    delete document.body.dataset['phase'];
  }

  private netSnapshot(): KekeNetSnapshot | null {
    const room = this.room;
    if (room === null) return null;
    const me = this.view?.me ?? null;
    const mine = this.worldView?.players.get(room.sessionId);
    return {
      code: this.code,
      sessionId: room.sessionId,
      phase: this.view?.phase ?? 'lobby',
      controlling: this.controlling,
      spectator: me?.spectator ?? false,
      spectating: this.spectating,
      pendingInputs: this.predictor.pendingCount,
      ack: me?.ack ?? 0,
      lastCorrection: this.predictor.lastCorrection,
      van: mine?.van ?? -1,
      carrying: mine?.carrying ?? 0,
      target: mine?.target ?? 0,
      deposited: mine?.deposited ?? 0,
      ...this.combatSnapshot(room.sessionId),
    };
  }

  private combatSnapshot(id: string): KekeCombatSnapshot {
    const c = this.combat.get(id) ?? DEFAULT_COMBAT;
    return {
      hp: c.hp,
      alive: c.alive,
      weapon: c.weapon,
      weaponUses: c.uses,
      stunned: c.stunned,
      protected: c.protected,
      blocking: c.blocking,
      charging: c.charging,
      respawnIn: c.respawnIn,
      sliding: c.sliding,
    };
  }

  private remoteSnapshots(): KekeRemoteSnapshot[] {
    const view = this.view;
    if (view === null) return [];
    const out: KekeRemoteSnapshot[] = [];
    for (const p of view.players) {
      const remote = this.remotes.get(p.id);
      if (!remote) continue;
      out.push({
        id: p.id,
        nickname: p.nickname,
        x: remote.avatar.body.x,
        y: remote.avatar.body.y,
        serverX: p.x,
        serverY: p.y,
        connected: p.connected,
        ...this.combatSnapshot(p.id),
      });
    }
    return out;
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
      .rectangle(this.predictor.state.x, this.predictor.state.y, size, size)
      .setStrokeStyle(1, 0x00ff00)
      .setDepth(DEPTH.debug + 1);

    this.readout = document.createElement('pre');
    this.readout.id = 'keke-debug';
    Object.assign(this.readout.style, {
      position: 'fixed',
      // Bottom-left: the HUD scoreboard sits top-right and the minimap bottom-right.
      bottom: '8px',
      left: '8px',
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
      player: () => {
        const p = this.predictor.state;
        return {
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          facing: this.local.currentFacing,
          zone: model.zoneAt(p.x, p.y)?.id ?? null,
        };
      },
      teleport: (x, y) => {
        if (aabbOverlapsSolid(model.collision, { x, y }, playerHalfSize(this.config))) return false;
        // In a room the server owns every position: ask it (debug servers only, KEKE_DEBUG=1).
        if (this.room !== null) {
          this.room.send(DebugMessage.teleport, { x, y });
          return true;
        }
        this.predictor.reset({ x, y, vx: 0, vy: 0 });
        this.local.place(x, y, { x: 0, y: 0 });
        this.cameras.main.centerOn(x, y);
        return true;
      },
      endPhase: () => {
        if (this.room === null) return false;
        this.room.send(DebugMessage.endPhase);
        return true;
      },
      zoneAt: (x, y) => model.zoneAt(x, y)?.id ?? null,
      net: () => this.netSnapshot(),
      remotePlayers: () => this.remoteSnapshots(),
      minimap: () => (this.minimap?.markers ?? []).map((m) => ({ ...m })),
      items: () => this.world.itemSnapshots(),
      vans: () => this.world.vanSnapshots(),
      combatEvents: () => this.combatFx?.events() ?? [],
      sprayClouds: () => this.sprayFx?.clouds(this.time.now / 1000) ?? [],
      projectiles: () => this.projectiles?.snapshots() ?? [],
      traps: () =>
        (this.peels?.snapshots() ?? []).map(({ id, weapon, owner, x, y, armed }) => ({
          id,
          weapon,
          owner,
          x,
          y,
          armed,
        })),
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
    const p = this.predictor.state;
    this.hitbox?.setPosition(p.x, p.y);
    if (this.readout) {
      this.readout.textContent = t('debug.readout', {
        x: Math.round(p.x),
        y: Math.round(p.y),
        zone: this.model.zoneAt(p.x, p.y)?.id ?? '-',
        device: this.inputManager.device,
        fps: Math.round(this.game.loop.actualFps),
      });
    }
  }

  private teardownDebug(): void {
    this.readout?.remove();
    this.readout = undefined;
    if (this.hook) removeHook(this.hook);
    this.hook = undefined;
  }
}
