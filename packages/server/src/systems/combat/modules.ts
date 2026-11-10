// The behaviour modules the CombatSystem runs, in order. M4-3 to M4-6 each add one line here (thrown,
// spray, trap, block / shot / charge); a module that softens or cancels hits (block) should come first.
// Modules that fire projectiles (thrown, the champagne shot) share the one ProjectileSystem below.
// Modules with per-round state are created fresh for every CombatSystem (one per room).
import type { GameState } from '../../schema/GameState';
import { createBlockBehaviour } from './block';
import { createChargeBehaviour } from './charge';
import { meleeBehaviour } from './melee';
import { ProjectileSystem } from './projectiles';
import { shotBehaviour } from './shot';
import { createSprayBehaviour } from './spray';
import { thrownBehaviour } from './thrown';
import type { BehaviourModule } from './types';

export function defaultCombatModules(state: GameState): BehaviourModule[] {
  const projectiles = new ProjectileSystem(state);
  return [
    createBlockBehaviour(projectiles),
    meleeBehaviour,
    createSprayBehaviour(),
    projectiles,
    thrownBehaviour(projectiles),
    shotBehaviour(projectiles),
    createChargeBehaviour(),
  ];
}
