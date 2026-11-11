import type { Room } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  CombatEventMessage,
  DebugMessage,
  NpcEventMessage,
  RaceEventMessage,
  TILE_LAYERS,
  aabbOverlapsSolid,
  getItemCatalogue,
  getNpcCatalogue,
  getWeaponCatalogue,
  inputStepSeconds,
  loadConfig,
  loadMap,
  playerHalfSize,
  vanSpawn,
  gridWithBlocked,
  type GameConfig,
  type KoMessage,
  type WeaponRolledMessage,
  type MapModel,
  type MapTheme,
  type Vec2,
  GateEventMessage,
  type GateStopMessage,
  gateStopped,
} from '@keke/shared';
import Phaser from 'phaser';
import { AmbientSounds } from '../audio/ambient';
import { audioEngine } from '../audio/engine';
import { Sfx } from '../audio/sfx';
import {
  CueGate,
  combatCues,
  itemCues,
  npcCues,
  cueVolume,
  roundCues,
  type RoundClock,
  type SoundCue,
} from '../audio/sfxPlan';
import { createManifestAnimations, preloadManifestAssets } from '../game/assets';
import { themeAtlasKey, type AssetManifest } from '../game/manifest';
import { Avatar } from '../game/avatar';
import { CombatFx, type FxBody } from '../game/combatFx';
import { SprayFx } from '../game/sprayFx';
import { isDebugEnabled } from '../game/debugFlag';
import { placeZoneLabels } from '../game/debugLayout';
import { installHook, removeHook, type KekeHook } from '../game/hook';
import type {
  KekeCombatSnapshot,
  KekeNetSnapshot,
  KekeRaceEvent,
  KekeRemoteSnapshot,
} from '../game/hookTypes';
import { rawMapFor } from '../game/mapSource';
import { stateMapId, themeFor, themeFromQuery } from '../game/mapTheme';
import { renderConfig } from '../game/renderConfig';
import { SpectatorCycle, spectateCandidates } from '../game/spectate';
import { PeelRenderer } from '../game/peels';
import { NpcRenderer } from '../game/npcs';
import { hearingVolume, npcMelee, npcTypeFromId } from '../game/npcLook';
import { WorldRenderer } from '../game/worldItems';
import { playerBodyOutline } from '../game/worldLayout';
import { ProjectileRenderer } from '../game/projectiles';
import { Hud } from '../hud/Hud';
import { readCombatHud, weaponName } from '../hud/combatHud';
import {
  COMBAT_FEED_MESSAGES,
  FEED_MESSAGES,
  NPC_FEED_MESSAGES,
  RACE_FEED_MESSAGES,
  combatFeedLine,
  feedLine,
  teamMoveLine,
  npcFeedLine,
  raceFeedLine,
  type RaceNames,
} from '../hud/feed';
import { readHud, type HudContext } from '../hud/hudState';
import { anyInReach, pickPrompts, type PromptState } from '../hud/prompts';
import { RoundScreen } from '../hud/RoundScreen';
import { GameMenu } from '../ui/gameMenu';
import { readRoundScreen } from '../hud/roundScreens';
import { t, type MessageKey } from '../i18n';
import { GateLayer, type GateBody } from '../game/gates';
import { InputManager, STANDARD, coneAimAssist, inputConfig } from '../input';
import {
  DEFAULT_COMBAT,
  blockSpeed,
  predictionSpeed,
  readCombat,
  type CombatPlayerView,
} from '../net/combatView';
import { SnapshotBuffer } from '../net/interpolation';
import { isControlling, isOnMap, readGame, sceneForPhase, type GameView } from '../net/gameView';
import { FixedStepClock, Predictor, inputSequenceFor, type InputSequence } from '../net/prediction';
import { ROOM_CODE_REGISTRY_KEY, currentRoom, setCurrentRoom } from '../net/session';
import { readLobby } from '../net/lobbyView';
import { readTraps } from '../net/trapView';
import { cartTileKeys, readNpcs, readStockCarts } from '../net/npcView';
import { readWanted } from '../net/wantedView';
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
  /** The round's map (P1-5): its tiles, items, music, brand name and colours. */
  private theme!: MapTheme;
  /** The asset manifest: theme-coloured sheet keys (van, order box) come from it. */
  private manifest: AssetManifest | undefined;
  private model!: MapModel;
  private config!: GameConfig;
  private inputManager!: InputManager;
  private local!: Avatar;
  private predictor!: Predictor;
  /** Tiles covered by parked stock carts (M5-3): prediction treats them as walls, like the server. */
  private cartTiles = new Set<number>();
  /** Scene seconds of the last customer gasp (one per group panic, P2-4). */
  private lastGaspAt = -Infinity;
  private clock!: FixedStepClock;
  private lastMove: Vec2 = { x: 0, y: 0 };
  /** Aim and buttons of the last sampled input frame (held weapon, predicted swing, block pose). */
  private lastAim = 0;
  private lastButtons = 0;
  private minimap: MinimapView | undefined;
  /** Profile colour, for the offline minimap. */
  private profileColor = '';
  /** Items and vans (M3-6). */
  private world!: WorldRenderer;
  /** Self-checkout gate sprites and stop bubbles (P2-1); none on a map without checkout gates. */
  private gateLayer: GateLayer | undefined;

  // Online only.
  private room: Room | null = null;
  private code = '';
  private sequence: InputSequence | null = null;
  private view: GameView | null = null;
  /** Our team at the last patch (M6 review F7: tell us when a rebalance moves us). */
  private lastTeam: number | undefined;
  private worldView: WorldView | null = null;
  private controlling = false;
  private remotes = new Map<string, Remote>();
  private spectatorCycle = new SpectatorCycle(renderConfig.spectatorCycleSeconds);
  private spectating: string | null = null;
  private spectateBanner: HTMLElement | undefined;
  private leaving = false;
  private unsubscribe: (() => void)[] = [];
  private hud: Hud | undefined;
  /** Esc / Start menu (M7 review F5); never pauses the round. */
  private menu: GameMenu | undefined;
  /** Round intro / results / podium panels (§13.1); online only. */
  private roundScreen: RoundScreen | undefined;
  private hudContext!: HudContext;
  /** Race broadcasts received (M6-3), newest last, for the debug hook. */
  private raceEvents: KekeRaceEvent[] = [];
  /** Race: points in the box delivered this round (round results add it to the deliverer's row). */
  private deliveredPoints = 0;
  private icons = new Map<string, string | null>();
  /** Swings, hit flashes, stun rings and HP bars (M4-2); online only. */
  private combatFx: CombatFx | undefined;
  private sprayFx: SprayFx | undefined;
  private projectiles: ProjectileRenderer | undefined;
  private combat = new Map<string, CombatPlayerView>();
  /** Banana peels on the floor (M4-5); online only. */
  private peels: PeelRenderer | undefined;
  /** Who knocked us out (last `ko` about us), for the KO overlay; cleared on respawn. */
  private koBy: { name: string; weapon: string | null } | null = null;
  private weaponIcons = new Map<string, string | null>();
  /** Store workers and stock carts (M5-7); online only. */
  private npcs: NpcRenderer | undefined;
  /** Sound effects (§12); online only. */
  private sfx: Sfx | undefined;
  /** The map's ambient loops (P2-6: the bottle machines' hum), fading with distance from us. */
  private ambient: AmbientSounds | undefined;
  private cueGate = new CueGate();
  /** Round phase and intro seconds at the last patch, for the countdown and round-end sounds. */
  private roundClock: RoundClock | null = null;

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
    const current = currentRoom();
    // P1-5: the room's map (GameState.mapId), or `?map=` in the offline walk.
    this.theme = current ? themeFor(stateMapId(current.room.state)) : themeFromQuery(window.location.search);
    this.config = loadConfig();
    const raw = rawMapFor(this.theme);
    this.model = loadMap(raw, this.theme.assets.map);
    this.resetFields();

    this.room = current?.room ?? null;
    this.code = current?.code ?? '';

    this.manifest = createManifestAnimations(this);
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
    // §13.3: with the right stick idle, aim snaps toward the nearest enemy in a 30° cone.
    this.inputManager.setAimAssist(
      coneAimAssist(() => this.enemyPositions(), inputConfig.aimAssistConeDegrees),
    );
    this.clock = new FixedStepClock(inputStepSeconds(this.config));
    this.createMenu();

    if (this.debug) this.createDebug();
    // §12: the map's music loops while the Game scene runs (intro, round, results and podium).
    audioEngine().startMusic(`assets/${this.theme.assets.music}`);
    // P3-2: a session can move to another map between rounds; fetch every loaded map's music now so the
    // switch does not start in silence. Tiles and sheets of every theme come with the manifest already.
    if (current) this.preloadRoomMusic(current.room.state);
    this.ambient = new AmbientSounds(this.model.ambientSounds);
    this.ambient.start();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    document.body.dataset['scene'] = 'game';
    document.body.dataset['map'] = this.theme.id;

    if (this.room !== null) this.joinRoom(this.room);
  }

  override update(time: number, deltaMs: number): void {
    if (this.leaving) return;
    const dt = Math.min(deltaMs / 1000, renderConfig.maxFrameSeconds);
    const offline = this.room === null;

    this.menu?.pollPad(this.inputManager.padPressed());
    const menuOpen = this.menu?.isOpen === true;
    const steps = this.clock.advance(dt);
    // Customers are solid (P2-4): predict around them where we drew them last frame.
    if (this.npcs) this.predictor.setSolids(this.npcs.solidBodies());
    for (let i = 0; i < steps; i++) {
      if (!offline && !this.controlling) break;
      this.inputManager.setOrigin(this.predictor.state);
      const sampled = this.inputManager.sample();
      // The round keeps running behind the menu: send idle frames (aim kept) instead of nothing.
      const frame = menuOpen ? { ...sampled, move: { x: 0, y: 0 }, buttons: 0 } : sampled;
      this.lastMove = frame.move;
      if (offline) {
        this.predictor.apply(frame, false);
      } else if (this.room && this.sequence) {
        const sent = { ...frame, seq: this.sequence.next() };
        this.predictor.apply(sent);
        this.room.send(ClientMessage.input, sent);
      }
      // After the step, like the server: a frame that ends stopped at a checkout gate cannot attack.
      if (!offline && !gateStopped(this.predictor.state.gate)) this.onLocalButtons(frame.buttons, frame.aim);
      this.lastAim = frame.aim;
      this.lastButtons = frame.buttons;
    }
    if (!offline && !this.controlling) {
      this.lastMove = { x: 0, y: 0 };
      this.lastButtons = 0;
    }

    // Server-moved corrections (dash, slide, shove) ease in over 0.1 s instead of jumping (M4 review F7).
    this.predictor.smooth(dt);
    const pos = this.predictor.renderPosition(this.clock.alpha);
    this.local.place(pos.x, pos.y, this.lastMove);
    this.cutCameraOnJump(pos);

    if (!offline) this.updateRemotes(dt);
    const npcAnchors = this.drawNpcs(time / 1000);
    this.drawCombat(time / 1000, npcAnchors);
    this.projectiles?.draw(time / 1000);
    this.updateMinimap(dt);
    this.ambient?.update(this.listenerPosition());
    this.world.draw((id) => this.drawnPosition(id), time / 1000);
    this.gateLayer?.update(this.gateBodies(), time / 1000);
    if (this.hud) this.updateHud(this.hud);
    if (this.debug) this.updateDebug();
  }

  /**
   * A respawn (or teleport) moves us across the map in one go: cut the camera to us instead of sliding
   * over the store (playtest 1). Walking never gets this far ahead of the follow lerp.
   */
  private cutCameraOnJump(pos: Vec2): void {
    const cam = this.cameras.main;
    if (this.spectating !== null) return;
    const mid = cam.midPoint;
    if (Math.hypot(mid.x - pos.x, mid.y - pos.y) > renderConfig.cameraCutPx) cam.centerOn(pos.x, pos.y);
  }

  /** Scene objects are reused between runs; fields that hold per-run state start fresh here. */
  private resetFields(): void {
    this.lastMove = { x: 0, y: 0 };
    this.room = null;
    this.code = '';
    this.sequence = null;
    this.view = null;
    this.lastTeam = undefined;
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
    this.koBy = null;
    this.weaponIcons = new Map();
    this.npcs = undefined;
    this.sfx = undefined;
    this.cueGate = new CueGate();
    this.roundClock = null;
    this.lastAim = 0;
    this.lastButtons = 0;
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
    const width = this.model.collision.width;
    const live = {
      ...this.model,
      collision: gridWithBlocked(this.model.collision, (tx, ty) => this.cartTiles.has(ty * width + tx)),
    };
    this.predictor = new Predictor(live, this.config, start);

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
    this.world = new WorldRenderer(
      this,
      this.model,
      this.theme.id,
      {
        van: DEPTH.decor + 0.5,
        item: DEPTH.player - 0.5,
        carried: DEPTH.player + 0.6,
      },
      {
        // The picked map's colours (P1-5), even while its tiles are still the default map's.
        van: themeAtlasKey(this.manifest, this.theme.id, 'van'),
        orderBox: themeAtlasKey(this.manifest, this.theme.id, 'order_box'),
      },
    );
    this.gateLayer = new GateLayer(this, this.model.gates, {
      atlas: themeAtlasKey(this.manifest, this.theme.id, 'gate'),
      tileSize: this.model.tileSize,
      halfSize: playerHalfSize(this.config).hw,
      depth: DEPTH.decor + 0.4,
      bubbleDepth: DEPTH.label + 0.5,
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
      return buildMinimapMarkers(world, { vanSlots: this.model.vanSlots, office: this.officeCentre() });
    });
  }

  // --- room -----------------------------------------------------------------------------------------

  /** Starts loading the music of every map the room's server has (P3-2). */
  private preloadRoomMusic(state: unknown): void {
    for (const id of readLobby(state, '').loadedMaps) {
      audioEngine().preload(`assets/${themeFor(id).assets.music}`);
    }
  }

  private joinRoom(room: Room): void {
    this.sequence = inputSequenceFor(room, this.config.maxQueuedInputs);
    this.sfx = new Sfx();
    this.createHud(room);
    this.createCombatFx(room);
    this.projectiles = new ProjectileRenderer(
      this,
      DEPTH.fx,
      (weapon) => getWeaponCatalogue().get(weapon)?.sprite ?? weapon,
    );
    this.peels = new PeelRenderer(
      this,
      DEPTH.player - 0.6,
      (weapon) => getWeaponCatalogue().get(weapon)?.sprite ?? weapon,
    );
    this.roundScreen = new RoundScreen(this.theme);
    this.createNpcs(room);
    this.createRace(room);
    this.createGates(room);
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
    if (view.phase === 'countdown') this.deliveredPoints = 0;
    const screen = readRoundScreen(room.state, room.sessionId, this.deliveredPoints);
    this.roundScreen?.render(screen);
    const clock = { phase: view.phase, seconds: screen.kind === 'intro' ? screen.seconds : 0 };
    this.playCues(roundCues(this.roundClock, clock));
    this.roundClock = clock;

    if (sceneForPhase(view.phase) !== 'Game') {
      // The session is over (podium → lobby): everyone goes back to the lobby.
      this.leaving = true;
      this.scene.start(sceneForPhase(view.phase));
      return;
    }
    if (themeFor(stateMapId(room.state)).id !== this.theme.id) {
      // The next round is on another map (P1-5): build the scene again for it, still in the room.
      this.leaving = true;
      this.scene.restart();
      return;
    }

    const me = view.me;
    if (me === null) return;
    this.sequence?.sync(me.ack);
    const moved = view.teams ? teamMoveLine(this.lastTeam, me.team) : null;
    if (moved) this.hud?.pushFeed(moved, performance.now());
    this.lastTeam = me.team;
    this.local.setLook(me);
    this.local.setOutline(playerBodyOutline(me.team, view.teams));
    this.local.setLabel(me.nickname);
    this.local.setVisible(isOnMap(me, view.phase));

    const controlling = isControlling(view);
    this.combat = readCombat(room.state);
    // Same carry, stun, slow and KO speed as the server, from synced state (M2 review H1).
    const myCombat = this.combat.get(me.id) ?? DEFAULT_COMBAT;
    const block = blockSpeed(myCombat, getWeaponCatalogue());
    this.predictor.setModifiers({
      speedMultiplier: predictionSpeed(myCombat, me.carrying !== 0, this.config),
      carrying: me.carrying !== 0,
      ...(block === undefined ? {} : { blockSpeedMultiplier: block }),
    });
    if (controlling && this.controlling) {
      this.predictor.reconcile(me);
    } else {
      // Not simulated (countdown, results, spectating), or the round just started: take the server's body.
      this.predictor.reset(me);
      this.clock.reset();
    }
    this.controlling = controlling;

    this.renderCombatHud();
    const wanted = readWanted(room.state);
    this.local.setWanted(wanted.has(me.id));
    this.hud?.renderWanted(
      wanted.has(me.id) && view.phase === 'playing' ? (wanted.get(me.id)?.seconds ?? 0) : null,
    );

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
      remote.avatar.setOutline(playerBodyOutline(p.team, view.teams));
      remote.avatar.setConnected(p.connected);
      remote.avatar.setLabel(p.connected ? p.nickname : t('game.reconnecting', { name: p.nickname }));
      remote.avatar.setWanted(wanted.has(p.id));
    }
    for (const [id, remote] of this.remotes) {
      if (seen.has(id)) continue;
      remote.avatar.destroy();
      this.remotes.delete(id);
    }
    this.syncWorld(room.state, view);
    this.peels?.sync(readTraps(room.state));
    const carts = readStockCarts(room.state);
    this.cartTiles = cartTileKeys(carts, this.model.collision.width);
    this.npcs?.sync(readNpcs(room.state), carts, now);
  }

  private updateRemotes(dt: number): void {
    const now = performance.now();
    for (const remote of this.remotes.values()) {
      const pos = remote.buffer.sample(now);
      if (pos) remote.avatar.place(pos.x, pos.y);
    }
    this.updateSpectator(dt);
  }

  // --- combat (M4-2 feedback, M4-7 visuals and HUD) --------------------------------------------------

  private createCombatFx(room: Room): void {
    const weapons = getWeaponCatalogue();
    const fx = new CombatFx(this, DEPTH.fx, weapons, this.config.maxHp, room.sessionId, this.model.tileSize);
    this.combatFx = fx;
    // Spray cones under the labels; vision clouds over everything in the world, nameplates too (M4-4).
    const spray = new SprayFx(this, DEPTH.fx, DEPTH.label + 1, weapons, renderConfig);
    this.sprayFx = spray;
    const nameOf = (id: string): string => this.view?.players.find((p) => p.id === id)?.nickname ?? id;
    const cueCtx = {
      me: room.sessionId,
      blocking: (id: string) => this.combat.get(id)?.blocking ?? false,
    };
    for (const type of Object.values(CombatEventMessage)) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          fx.onEvent(type, message, this.time.now / 1000);
          spray.onEvent(type, message, this.time.now / 1000);
          this.onCombatEvent(type, message, room.sessionId, nameOf);
          this.playCues(combatCues(type, message, cueCtx));
        }),
      );
    }
    const ctx = { weapons, me: room.sessionId, nameOf, npcName: (id: string) => this.npcName(id) };
    for (const type of COMBAT_FEED_MESSAGES) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          const line = combatFeedLine(type, message, ctx);
          if (line) this.hud?.pushFeed(line, performance.now());
        }),
      );
    }
  }

  /** KO overlay attribution and the new-weapon glow. */
  private onCombatEvent(type: string, message: unknown, me: string, nameOf: (id: string) => string): void {
    if (typeof message !== 'object' || message === null) return;
    if (type === CombatEventMessage.ko) {
      const ko = message as KoMessage;
      if (ko.player !== me) return;
      const src = ko.source as KoMessage['source'] | undefined;
      if (src?.kind === 'player' && src.id !== me) {
        this.koBy = {
          name: nameOf(src.id),
          weapon: ko.weapon ? weaponName(ko.weapon, getWeaponCatalogue()) : null,
        };
      } else if (src?.kind === 'npc' || src?.kind === 'hazard') {
        // A store worker or a forklift (M5-7).
        const name = this.npcName(src.id);
        this.koBy = { name: name.charAt(0).toLocaleUpperCase() + name.slice(1), weapon: null };
      } else {
        this.koBy = null;
      }
      this.renderCombatHud();
    } else if (type === CombatEventMessage.respawn) {
      if ((message as { player?: unknown }).player === me) this.koBy = null;
    } else if (type === CombatEventMessage.weaponRolled) {
      if ((message as WeaponRolledMessage).player === me) this.hud?.flashWeapon(performance.now());
    }
  }

  /** Our own Attack press swings the held weapon at once (the server's echo confirms the hit). */
  private onLocalButtons(buttons: number, aim: number): void {
    const fx = this.combatFx;
    const me = this.room?.sessionId;
    if (!fx || me === undefined) return;
    const pressed = (buttons & Button.Attack) !== 0 && (this.lastButtons & Button.Attack) === 0;
    if (pressed) fx.predictAttack(this.combat.get(me) ?? DEFAULT_COMBAT, aim, this.time.now / 1000);
  }

  /** Bodies of other players that aim assist may snap to: alive, drawn, not on our team (§3.3). */
  private enemyPositions(): Vec2[] {
    const view = this.view;
    const me = view?.me;
    if (!view || !me) return [];
    const out: Vec2[] = [];
    for (const p of view.players) {
      if (p.isMe || (me.team > 0 && p.team === me.team)) continue;
      if (!(this.combat.get(p.id)?.alive ?? true)) continue;
      const body = this.remotes.get(p.id)?.avatar.body;
      if (body?.visible) out.push({ x: body.x, y: body.y });
    }
    return out;
  }

  /** HP bar, weapon slot and KO overlay from the last patch. */
  private renderCombatHud(): void {
    const hud = this.hud;
    const room = this.room;
    const view = this.view;
    if (!hud || room === null || view === null) return;
    const me = view.me;
    hud.renderCombat(
      readCombatHud({
        combat: me === null ? null : (this.combat.get(me.id) ?? DEFAULT_COMBAT),
        phase: view.phase,
        spectator: me?.spectator ?? true,
        maxHp: this.config.maxHp,
        weapons: getWeaponCatalogue(),
        warnFraction: renderConfig.hudHpWarnFraction,
        lowFraction: renderConfig.hudHpLowFraction,
      }),
      this.koBy,
    );
  }

  /** Avatar looks (KO, protection, hit flash), held weapons and the world FX, from the last patch. */
  private drawCombat(now: number, npcAnchors?: ReadonlyMap<string, Vec2>): void {
    const fx = this.combatFx;
    const room = this.room;
    if (!fx || room === null) return;
    const weapons = getWeaponCatalogue();
    const bodies: FxBody[] = [];
    const add = (id: string, avatar: Avatar, aim: number, blockHeld: boolean): void => {
      const combat = this.combat.get(id) ?? DEFAULT_COMBAT;
      avatar.setCombatLook(fx.lookFor(id, combat, now));
      // Our own block shows as soon as Block is held with a blocking weapon; the server's flag follows.
      const canBlock = weapons.get(combat.weapon)?.block !== undefined && combat.alive && !combat.stunned;
      bodies.push({
        id,
        pos: { x: avatar.body.x, y: avatar.body.y },
        combat,
        aim,
        blocking: combat.blocking || (blockHeld && canBlock),
        visible: avatar.body.visible,
        depth: avatar.body.depth,
      });
    };
    const me = room.sessionId;
    const myCombat = this.combat.get(me) ?? DEFAULT_COMBAT;
    add(
      me,
      this.local,
      this.controlling ? this.lastAim : myCombat.aim,
      (this.lastButtons & Button.Block) !== 0,
    );
    for (const [id, remote] of this.remotes) add(id, remote.avatar, this.combat.get(id)?.aim ?? 0, false);
    fx.draw(now, bodies, npcAnchors);
    this.sprayFx?.draw(now, (id) => {
      const avatar = id === room.sessionId ? this.local : this.remotes.get(id)?.avatar;
      return avatar?.body.visible ? { x: avatar.body.x, y: avatar.body.y } : undefined;
    });
  }

  // --- store workers and Wanted (M5-7) --------------------------------------------------------------

  private createNpcs(room: Room): void {
    const catalogue = getNpcCatalogue();
    const npcs = new NpcRenderer(
      this,
      { npc: DEPTH.player, floor: DEPTH.decor + 0.4, label: DEPTH.label, mapHeight: this.model.heightPx },
      catalogue,
      this.model.tileSize,
      1000 / this.config.serverTickHz,
    );
    this.npcs = npcs;
    const me = room.sessionId;
    for (const type of Object.values(NpcEventMessage)) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          const now = this.time.now / 1000;
          npcs.onEvent(type, message, now);
          const id = (message as { npc?: unknown } | null)?.npc;
          const def =
            typeof id === 'string' ? catalogue.get(npcs.typeOf(id) ?? npcTypeFromId(id)) : undefined;
          this.combatFx?.onNpcEvent(type, message, now, npcMelee(def));
          if (type === NpcEventMessage.wanted) this.onWanted(message, me);
          this.playCues(npcCues(type, message, me));
        }),
      );
    }
    const nameOf = (id: string): string => this.view?.players.find((p) => p.id === id)?.nickname ?? id;
    const ctx = {
      weapons: getWeaponCatalogue(),
      me,
      nameOf,
      npcName: (id: string) => this.npcName(id),
      near: (id: string) => this.isNearUs(id),
    };
    for (const type of NPC_FEED_MESSAGES) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          const line = npcFeedLine(type, message, ctx);
          if (line) this.hud?.pushFeed(line, performance.now());
        }),
      );
    }
  }

  /** Whether a player is drawn within `hudFeedNearPx` of us (Wanted feed lines, playtest 1 problem 8). */
  private isNearUs(sessionId: string): boolean {
    const them = this.drawnPosition(sessionId);
    if (them === undefined) return false;
    const us = this.predictor.state;
    return Math.hypot(them.x - us.x, them.y - us.y) <= renderConfig.hudFeedNearPx;
  }

  /** Where we hear from: our body, or the camera centre while it is hidden (KO, spectating). */
  private listenerPosition(): Vec2 {
    return this.local.body.visible
      ? { x: this.local.body.x, y: this.local.body.y }
      : this.cameras.main.midPoint;
  }

  /** Plays sound cues (§12): ours at full volume, other players' fading with distance from us. */
  private playCues(cues: readonly SoundCue[]): void {
    const sfx = this.sfx;
    if (!sfx || cues.length === 0) return;
    const now = performance.now() / 1000;
    const listener = this.listenerPosition();
    for (const cue of cues) {
      if (!this.cueGate.allow(cue, now)) continue;
      const src = cue.source;
      let volume = 1;
      if (src.kind === 'player' || src.kind === 'point') {
        const at = src.kind === 'player' ? this.drawnPosition(src.id) : src;
        volume = at ? hearingVolume(at, listener, renderConfig.sfxHearingPx) : 0;
      }
      sfx.play(cue.name, cueVolume(cue.name, src.kind, volume));
    }
  }

  /** The alarm (§12 "wanted alarm"): loud when we become Wanted, a short far one for anyone else. */
  private onWanted(message: unknown, me: string): void {
    if (typeof message !== 'object' || message === null) return;
    const { player, refreshed } = message as { player?: unknown; refreshed?: unknown };
    if (player === me) this.sfx?.play(refreshed === true ? 'wantedRefresh' : 'wantedAlarm');
    else if (refreshed !== true) this.sfx?.play('wantedAlarmFar');
  }

  /** Lower-case display name of a store worker (feed lines, KO overlay). */
  private npcName(id: string): string {
    const type = this.npcs?.typeOf(id) ?? npcTypeFromId(id);
    const key = `npc.${type}` as MessageKey;
    const name = t(key);
    if (name !== key) return name;
    return (getNpcCatalogue().get(type)?.name ?? type).toLocaleLowerCase();
  }

  /** Draws the workers and plays forklift beeps; returns where each worker is drawn (for combat FX). */
  private drawNpcs(now: number): ReadonlyMap<string, Vec2> | undefined {
    const npcs = this.npcs;
    if (!npcs) return undefined;
    const listener = this.listenerPosition();
    return npcs.draw(
      now,
      performance.now(),
      this.view?.phase === 'playing',
      (_id, at) => {
        this.sfx?.play('forkliftBeep', hearingVolume(at, listener, renderConfig.forkliftBeepHearingPx));
      },
      (_id, at) => {
        // A whole group panics in the same tick: one gasp for it, not four (P2-4).
        if (now - this.lastGaspAt < renderConfig.customerGaspMinGapSeconds) return;
        this.lastGaspAt = now;
        this.sfx?.play('customerGasp', hearingVolume(at, listener, renderConfig.sfxHearingPx));
      },
    );
  }

  // --- race mode (M6-3, §4.2) -----------------------------------------------------------------------

  /** Centre of the office trigger: the arrow's goal while carrying an order box, and the minimap marker. */
  private officeCentre(): Vec2 {
    const b = this.model.officeTrigger.bounds;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  /** Who a van belongs to as the feed names it: the team with Teams on, else its first player. */
  private vanName(van: number): string {
    const world = this.worldView;
    const view = this.view;
    if (world?.teams) {
      const team = world.vans.find((v) => v.van === van)?.team ?? 0;
      if (team > 0) return t('hud.score.team', { team });
    }
    const owner = view?.players.find((p) => world?.players.get(p.id)?.van === van);
    return owner?.nickname ?? t('hud.feed.somebody');
  }

  private raceNames(): RaceNames {
    return {
      boxVan: (id) => this.worldView?.items.find((i) => i.id === id)?.packedVan,
      vanOf: (id) => this.worldView?.players.get(id)?.van ?? -1,
      vanName: (van) => this.vanName(van),
    };
  }

  /** Race broadcasts: feed lines and placeholder sounds for a packed box and the winning delivery. */
  private createRace(room: Room): void {
    this.raceEvents = [];
    this.deliveredPoints = 0;
    const me = room.sessionId;
    const nameOf = (id: string): string => this.view?.players.find((p) => p.id === id)?.nickname ?? id;
    const ctx = { me, nameOf, vanName: (van: number) => this.vanName(van) };
    for (const type of RACE_FEED_MESSAGES) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          this.raceEvents.push({ type, payload: message });
          if (this.raceEvents.length > 50) this.raceEvents.shift();
          const line = raceFeedLine(type, message, ctx);
          if (line) this.hud?.pushFeed(line, performance.now());
          const player = (message as { player?: unknown } | null)?.player;
          if (type === RaceEventMessage.boxPacked && player === me) this.sfx?.play('boxPacked');
          if (type === RaceEventMessage.delivery) {
            this.sfx?.play('delivery');
            const points = (message as { points?: unknown } | null)?.points;
            this.deliveredPoints = typeof points === 'number' ? points : 0;
          }
        }),
      );
    }
  }

  /**
   * Gate stops (P2-1): the till beep (ours at full volume, others fading with distance) and a bubble over
   * the stopped player, "unexpected item in bagging area" for a carrier.
   */
  private createGates(room: Room): void {
    this.unsubscribe.push(
      room.onMessage(GateEventMessage.gateStop, (message: GateStopMessage) => {
        const at = this.drawnPosition(message.player);
        const mine = message.player === room.sessionId;
        const listener = this.local.body.visible
          ? { x: this.local.body.x, y: this.local.body.y }
          : this.cameras.main.midPoint;
        this.sfx?.play('gateBeep', mine || !at ? 1 : hearingVolume(at, listener, renderConfig.sfxHearingPx));
        if (!at) return;
        const text = t(message.carrying ? 'gate.unexpected' : 'gate.wait');
        this.gateLayer?.stopped(message, at, text, this.time.now / 1000);
      }),
    );
  }

  /** Bodies the gate sprites react to: us (predicted) and everyone drawn, with their stop state. */
  private gateBodies(): GateBody[] {
    const out: GateBody[] = [];
    if (this.local.body.visible) {
      out.push({
        x: this.local.body.x,
        y: this.local.body.y,
        stopped: gateStopped(this.predictor.state.gate),
      });
    }
    for (const p of this.view?.players ?? []) {
      if (p.isMe) continue;
      const at = this.drawnPosition(p.id);
      if (at) out.push({ ...at, stopped: gateStopped(p.gate) });
    }
    return out;
  }

  // --- HUD (§13.2) -----------------------------------------------------------------------------------

  /** Online only: the HUD shows round state, so `?scene=game` walk mode has none. */
  private createHud(room: Room): void {
    const catalogue = getItemCatalogue(this.theme.id);
    this.hudContext = {
      catalogue,
      vanSlots: this.model.vanSlots,
      office: this.officeCentre(),
      raceQuota: this.config.raceQuota,
      orderBoxAtlas: themeAtlasKey(this.manifest, this.theme.id, 'order_box'),
    };
    const hud = new Hud({
      iconFor: (sprite, atlas) => this.itemIcon(sprite, atlas),
      weaponIconFor: (sprite) => this.weaponIcon(sprite),
      theme: this.theme,
    });
    this.hud = hud;
    const nameOf = (id: string): string => this.view?.players.find((p) => p.id === id)?.nickname ?? id;
    const race = this.raceNames();
    for (const type of FEED_MESSAGES) {
      this.unsubscribe.push(
        room.onMessage(type, (message: unknown) => {
          const line = feedLine(type, message, { catalogue, nameOf, race, me: room.sessionId });
          if (line) hud.pushFeed(line, performance.now());
          this.playCues(itemCues(type, message, room.sessionId));
        }),
      );
    }
  }

  private updateHud(hud: Hud): void {
    hud.tick(performance.now());
    hud.setBoardOpen(this.menu?.isOpen !== true && this.inputManager.scoreboardHeld());
    const device = this.inputManager.device;
    hud.renderPrompts(pickPrompts(this.promptState(), device), device);
    hud.updateArrow((world) => this.worldToClient(world), {
      width: hud.root.clientWidth,
      height: hud.root.clientHeight,
    });
  }

  /** What the button prompts (F6) need from this frame. */
  private promptState(): PromptState {
    const me = this.view?.me ?? null;
    const combat = me === null ? DEFAULT_COMBAT : (this.combat.get(me.id) ?? DEFAULT_COMBAT);
    const carrying = me !== null && (this.worldView?.players.get(me.id)?.carrying ?? 0) !== 0;
    const lying = (this.worldView?.items ?? []).filter((item) => item.state !== 'carried');
    return {
      phase: this.view?.phase ?? 'lobby',
      playing: me !== null && !me.spectator,
      alive: combat.alive,
      controlling: this.controlling,
      carrying,
      itemInReach: !carrying && anyInReach(this.predictor.state, lying, this.config),
      canBlock: getWeaponCatalogue().get(combat.weapon)?.block !== undefined,
      menuOpen: this.menu?.isOpen === true,
    };
  }

  /** World pixels to CSS pixels in the viewport (HUD arrow, debug hook). */
  private worldToClient(world: Vec2): Vec2 {
    const cam = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    const scaleX = this.scale.width > 0 ? rect.width / this.scale.width : 1;
    const scaleY = this.scale.height > 0 ? rect.height / this.scale.height : 1;
    return {
      x: rect.left + ((world.x - cam.worldView.x) * cam.zoom + cam.x) * scaleX,
      y: rect.top + ((world.y - cam.worldView.y) * cam.zoom + cam.y) * scaleY,
    };
  }

  /** Data URL of an atlas frame (`items`, or `order_box`) for the HUD card and carry slot, cached per frame. */
  private itemIcon(sprite: string, atlas: string): string | null {
    const key = `${atlas}/${sprite}`;
    const cached = this.icons.get(key);
    if (cached !== undefined) return cached;
    let url: string | null = null;
    if (this.textures.exists(atlas) && this.textures.get(atlas).has(sprite)) {
      url = this.textures.getBase64(atlas, sprite) || null;
    }
    this.icons.set(key, url);
    return url;
  }

  /** Data URL of a `weapons` atlas frame for the HUD weapon slot, cached per frame. */
  private weaponIcon(sprite: string): string | null {
    const cached = this.weaponIcons.get(sprite);
    if (cached !== undefined) return cached;
    let url: string | null = null;
    if (this.textures.exists('weapons') && this.textures.get('weapons').has(sprite)) {
      url = this.textures.getBase64('weapons', sprite) || null;
    }
    this.weaponIcons.set(sprite, url);
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
      banner.style.setProperty('--keke-accent', this.theme.colors.primary);
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

  // --- In-game menu (§13.3 Menu, M7 review F5) ------------------------------------------------------

  private createMenu(): void {
    const online = this.room !== null;
    this.menu = new GameMenu({
      leaveLabel: online ? t('menu.leave') : t('menu.backToTitle'),
      confirmText: online ? t('menu.leaveText', { code: this.code }) : t('menu.leaveTextOffline'),
      onLeave: () => this.leaveGame(),
      device: this.inputManager.device,
      onDeviceChange: (listener) => this.inputManager.onDeviceChange(listener),
      theme: this.theme,
    });
  }

  /**
   * Leave room from the menu: a consented leave, so the server drops our slot at once instead of
   * holding it for the 30 s reconnect window, then back to Play (offline walk mode: back to Title).
   */
  private leaveGame(): void {
    if (this.leaving) return;
    this.leaving = true;
    const room = this.room;
    if (room === null) {
      this.scene.start('Title');
      return;
    }
    void room.leave(true);
    setCurrentRoom(null);
    this.registry.remove(ROOM_CODE_REGISTRY_KEY);
    delete document.body.dataset['room'];
    this.scene.start('Play');
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
    this.menu?.destroy();
    this.menu = undefined;
    for (const remote of this.remotes.values()) remote.avatar.destroy();
    this.remotes.clear();
    this.world.destroy();
    this.gateLayer?.destroy();
    this.gateLayer = undefined;
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
    this.npcs?.destroy();
    this.npcs = undefined;
    this.sfx = undefined;
    this.ambient?.stop();
    this.ambient = undefined;
    audioEngine().stopMusic();
    this.teardownDebug();
    delete document.body.dataset['scene'];
    delete document.body.dataset['map'];
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
      team: me?.team ?? 0,
      outline: this.local.outline,
      gateStop: me?.gate?.stop ?? 0,
      predictedGateStop: this.predictor.state.gate?.stop ?? 0,
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
      slowMultiplier: c.slowMultiplier,
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
        team: p.team,
        outline: remote.avatar.outline,
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
      // Bottom-left (above the sound button): the HUD scoreboard sits top-right and the minimap bottom-right.
      bottom: '50px',
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
      holdNpc: (npc, seconds) => {
        if (this.room === null) return false;
        this.room.send(DebugMessage.holdNpc, { npc, seconds });
        return true;
      },
      noNpcs: () => {
        if (this.room === null) return false;
        this.room.send(DebugMessage.noNpcs);
        return true;
      },
      giveWeapon: (weapon) => {
        if (this.room === null) return false;
        this.room.send(DebugMessage.giveWeapon, { weapon });
        return true;
      },
      vanPoints: (points) => {
        if (this.room === null) return false;
        this.room.send(DebugMessage.vanPoints, { points });
        return true;
      },
      zoneAt: (x, y) => model.zoneAt(x, y)?.id ?? null,
      gates: () => model.gates.map((g) => ({ ...g })),
      gateFx: () => this.gateLayer?.snapshot() ?? { stops: [], looks: [], bubbles: [] },
      net: () => this.netSnapshot(),
      remotePlayers: () => this.remoteSnapshots(),
      minimap: () => (this.minimap?.markers ?? []).map((m) => ({ ...m })),
      items: () => this.world.itemSnapshots(),
      vans: () => this.world.vanSnapshots(),
      raceEvents: () => this.raceEvents.map((e) => ({ ...e })),
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
      npcs: () => (this.room ? readNpcs(this.room.state) : []),
      stockCarts: () => (this.room ? readStockCarts(this.room.state) : []),
      npcSprites: () => this.npcs?.snapshots() ?? [],
      wantedIcons: () => {
        const out: string[] = [];
        if (this.room && this.local.wantedShown) out.push(this.room.sessionId);
        for (const [id, remote] of this.remotes) if (remote.avatar.wantedShown) out.push(id);
        return out;
      },
      sfx: () => ({ ...(this.sfx?.played() ?? {}) }),
      musicDucks: () => this.sfx?.ducks() ?? 0,
      music: () => audioEngine().musicTrack(),
      ambient: () => this.ambient?.levels() ?? [],
      held: () => this.combatFx?.heldSnapshots() ?? [],
      swings: () => this.combatFx?.swingSnapshot() ?? { predicted: 0, last: null },
      fx: () => this.combatFx?.fxSnapshots() ?? [],
      fxStarted: () => this.combatFx?.startedSnapshots() ?? [],
      screenPoint: (x, y) => this.worldToClient({ x, y }),
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
