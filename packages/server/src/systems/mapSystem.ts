// Systems the room builds once per map (P3-1): the room keeps them in one list so a map switch between
// rounds, and the way back to the lobby, reset all of them, and each round start reaches all of them.
// A new per-map system (gates, carts, …) is built in `GameRoom.buildMapSystems` and added to that list.
import type { PlayerState } from '../schema/GameState';

export interface MapSystem {
  /**
   * Takes out of the synced state everything this system put there (items, bodies, timers), so the room
   * can drop the system for another map's or go back to the lobby. Called on the old system before a
   * rebuild for another map, and in the lobby.
   */
  reset(): void;
  /**
   * Countdown: a new round on this map. `players` are the round's players in join order, already at
   * their vans. Systems run in the order they were added to the list.
   */
  startRound?(players: readonly PlayerState[]): void;
}
