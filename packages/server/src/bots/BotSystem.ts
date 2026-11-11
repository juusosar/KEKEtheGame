// Bot players on the server (host setting `bots`). The room keeps bot players in `GameState.players` like
// anyone else (flag `bot`); this system plays them. Each tick, before the movement tick, it asks every bot's
// brain for the input frames a client would have sent since the last tick (inputHz per second) and queues
// them through the same input queue. So bots move, pick up, fight and score by exactly the rules people do.
import {
  createRng,
  hazardZones,
  isBotLevel,
  zonesAt,
  type BotLevel,
  type CollisionGrid,
  type GameConfig,
  type InputFrame,
  type MapModel,
  type Rng,
} from '@keke/shared';
import type { GameState, PlayerState } from '../schema/GameState';
import type { MapSystem } from '../systems/mapSystem';
import { BotBrain, type BotMap } from './brain';
import { BOT_SKILLS } from './skill';

export interface BotSystemDeps {
  readonly state: GameState;
  /** Queues one frame for a player, as a client message would (MovementSystem.receive). */
  readonly receive: (player: PlayerState, frame: InputFrame) => void;
  readonly seed: number;
}

export class BotSystem implements MapSystem {
  private readonly brains = new Map<string, BotBrain>();
  /** Last seq sent per bot. Survives map changes: the input queue refuses a seq it has seen. */
  private readonly seqs = new Map<string, number>();
  /** Fractional frames owed: inputHz / serverTickHz per tick (1.5 at the defaults). */
  private credit = 0;
  private world: BotMap | undefined;
  private config: GameConfig | undefined;
  private readonly rng: Rng;

  constructor(private readonly deps: BotSystemDeps) {
    this.rng = createRng(deps.seed);
  }

  /** The map the next rounds run on (the room's map systems were rebuilt). */
  useMap(map: MapModel, grid: CollisionGrid, config: GameConfig): void {
    this.world = botMap(map, grid);
    this.config = config;
    this.reset();
  }

  /** Map switch, lobby: every bot thinks afresh. */
  reset(): void {
    this.brains.clear();
    this.credit = 0;
  }

  startRound(): void {
    this.reset();
  }

  /** A bot left the room. */
  remove(id: string): void {
    this.brains.delete(id);
    this.seqs.delete(id);
  }

  /** The brain playing `id` this round, for tests. */
  brain(id: string): BotBrain | undefined {
    return this.brains.get(id);
  }

  /** One server tick of the 'playing' phase: queues each bot's frames. */
  tick(): void {
    const config = this.config;
    const world = this.world;
    if (!config || !world) return;
    this.credit += config.inputHz / config.serverTickHz;
    const frames = Math.floor(this.credit);
    this.credit -= frames;
    if (frames === 0) return;
    const level = this.level();
    const bots = [...this.deps.state.players.values()]
      .filter((p) => p.bot && !p.spectator)
      .sort((a, b) => a.joinOrder - b.joinOrder);
    bots.forEach((player, seat) => {
      let brain = this.brains.get(player.sessionId);
      if (!brain) {
        const skill = BOT_SKILLS[level];
        const persona = skill.personas[seat % skill.personas.length] ?? 'runner';
        brain = new BotBrain(persona, skill, config, world, createRng(this.rng.int(0, 0x7fffffff)));
        this.brains.set(player.sessionId, brain);
      }
      for (let i = 0; i < frames; i++) {
        const seq = Math.max(this.seqs.get(player.sessionId) ?? 0, player.ack) + 1;
        this.seqs.set(player.sessionId, seq);
        this.deps.receive(player, { seq, ...brain.frame(player, this.deps.state) });
      }
    });
  }

  private level(): BotLevel {
    const level = this.deps.state.settings.botLevel;
    return isBotLevel(level) ? level : 'normal';
  }
}

/** What bots need of a map: its live grid, the tiles a careful bot keeps off, the office. */
export function botMap(map: MapModel, grid: CollisionGrid): BotMap {
  const ts = map.collision.tileSize;
  const w = map.collision.width;
  const h = map.collision.height;
  // Staff-only rooms make you Wanted on entry; the oven burns. Tiles whose centre lies in one are avoided.
  const bad = [...map.zones.filter((z) => z.wantedOnEnter), ...hazardZones(map.zones)];
  const avoid = new Uint8Array(w * h);
  for (const zone of bad) {
    const b = zone.bounds;
    const x0 = Math.max(0, Math.floor(b.minX / ts));
    const x1 = Math.min(w - 1, Math.floor(b.maxX / ts));
    const y0 = Math.max(0, Math.floor(b.minY / ts));
    const y1 = Math.min(h - 1, Math.floor(b.maxY / ts));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const cx = (tx + 0.5) * ts;
        const cy = (ty + 0.5) * ts;
        if (zonesAt([zone], cx, cy).length > 0) avoid[ty * w + tx] = 1;
      }
    }
  }
  const office = map.officeTrigger.bounds;
  return {
    map,
    grid,
    avoid: (tx, ty) => tx >= 0 && ty >= 0 && tx < w && ty < h && avoid[ty * w + tx] === 1,
    office: { x: (office.minX + office.maxX) / 2, y: (office.minY + office.maxY) / 2 },
  };
}
