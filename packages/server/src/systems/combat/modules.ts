// The behaviour modules the CombatSystem runs, in order. M4-3 to M4-6 each add one line here (thrown,
// spray, trap, block / shot / charge); a module that softens or cancels hits (block) should come first.
import { meleeBehaviour } from './melee';
import type { BehaviourModule } from './types';

export function defaultCombatModules(): BehaviourModule[] {
  return [meleeBehaviour];
}
