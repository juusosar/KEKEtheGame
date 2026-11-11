// Floor hazards on the server (Phase 2 decision 10, P2-2): the bakery oven on the second store. Zones with
// `damagePerSecond` burn the round players standing in them every `hazardTickSeconds`, through the combat
// damage path (KO drops the carried item, respawn at the van). The source is `{ kind: 'hazard', id: zone }`:
// team rules never stop it and it never makes anyone Wanted. Spectators, KO'd players and dropped players
// waiting for a reconnect are never burnt.
import {
  hazardTick,
  hazardZones,
  type GameConfig,
  type HazardClock,
  type MapModel,
  type Zone,
} from '@keke/shared';
import type { PlayerState } from '../schema/GameState';
import type { CombatHit } from './combat/types';
import type { MapSystem } from './mapSystem';

export class HazardSystem implements MapSystem {
  private readonly hazards: readonly Zone[];
  private clock: HazardClock = new Map();

  constructor(
    map: MapModel,
    private readonly config: GameConfig,
    /** Lands one burn (CombatSystem.externalHit). True when it landed. */
    private readonly hit: (hit: CombatHit) => boolean,
  ) {
    this.hazards = hazardZones(map.zones);
  }

  /** True when the map has a zone that hurts. */
  get active(): boolean {
    return this.hazards.length > 0;
  }

  /** One server tick, after attacks resolve. */
  tick(now: number, players: Iterable<PlayerState>): void {
    if (this.hazards.length === 0) return;
    const bodies: { id: string; x: number; y: number }[] = [];
    for (const p of players) {
      if (p.spectator || !p.connected || !p.alive) continue;
      bodies.push({ id: p.sessionId, x: p.x, y: p.y });
    }
    const result = hazardTick(this.clock, this.hazards, bodies, now, this.config.hazardTickSeconds);
    this.clock = result.clock;
    for (const burn of result.burns) {
      this.hit({
        source: { kind: 'hazard', id: burn.zone },
        target: burn.target,
        damage: burn.damage,
        delivery: 'hazard',
      });
    }
  }

  /** Lobby or map switch: nobody has been burnt yet. */
  reset(): void {
    this.clock = new Map();
  }

  /** Countdown: a fresh clock for the new round. */
  startRound(): void {
    this.reset();
  }
}
