// Helpers for NPC tests without a network (M5-3): the combat testKit's players on van 0's floor plus an
// NpcSystem on a live map (stock carts block), wired the way GameRoom wires them. `tick` runs the room's
// order: combat.beginTick, frames, npcs.tick, combat.tick.
import { gridWithBlocked, type MapModel, type NpcEventWire, type Vec2, type WantedHit } from '@keke/shared';
import type { PlayerState } from '../../schema/GameState';
import { config, frame, kesproMap, setup as combatSetup, TICK, type Setup } from '../combat/testKit';
import { NpcSystem, type NpcHooks } from './NpcSystem';
import type { NpcBehaviourModule } from './types';

export interface NpcSetup extends Setup {
  npcs: NpcSystem;
  npcEvents: NpcEventWire[];
  npcHits: WantedHit[];
  live: MapModel;
}

export function npcSetup(
  players: number,
  at?: (i: number) => Vec2,
  options: {
    modules?: NpcBehaviourModule[];
    roundPlayers?: number;
    seed?: number;
    hooks?: Partial<NpcHooks>;
  } = {},
): NpcSetup {
  const base = combatSetup(players, at);
  const npcEvents: NpcEventWire[] = [];
  const npcHits: WantedHit[] = [];
  const holder: { npcs?: NpcSystem } = {};
  const map = kesproMap();
  const live: MapModel = {
    ...map,
    collision: gridWithBlocked(map.collision, (tx, ty) => holder.npcs?.isCartTile(tx, ty) ?? false),
  };
  const npcs = new NpcSystem(
    base.state,
    config,
    live,
    (e) => npcEvents.push(e),
    {
      hitPlayer: (hit) => base.combat.externalHit(hit),
      onNpcDamaged: (attacker, npc, damage) =>
        npcHits.push({ attacker, victim: { kind: 'npc', id: npc }, damage }),
      ...options.hooks,
    },
    options.seed ?? 7,
    options.modules,
  );
  holder.npcs = npcs;
  base.combat.npcTargets = npcs;
  npcs.startRound(options.roundPlayers ?? players);
  return { ...base, npcs, npcEvents, npcHits, live };
}

export function npcTick(s: NpcSetup, frames: () => void = () => undefined): void {
  s.now += TICK;
  s.combat.beginTick(s.now);
  frames();
  s.npcs.tick(s.now);
  s.combat.tick(s.now);
}

export function npcIdle(s: NpcSetup, seconds: number, each: () => void = () => undefined): void {
  const until = s.now + seconds;
  while (s.now < until - 1e-9) {
    npcTick(s);
    each();
  }
}

/** One tick in which `p` pressed `pressed` aiming at `aim`. */
export function npcPress(s: NpcSetup, p: PlayerState, pressed: number, aim = 0): void {
  npcTick(s, () => s.combat.afterFrame(p, frame(pressed, aim), pressed));
}

/** Moves an NPC's body to `at` (tests only). */
export function putNpc(s: NpcSetup, id: string, at: Vec2): void {
  const npc = s.npcs.npc(id);
  if (!npc) throw new Error(`no npc ${id}`);
  npc.state.x = at.x;
  npc.state.y = at.y;
}
