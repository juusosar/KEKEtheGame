// The NPC behaviours the NpcSystem runs, one per npcs.json behaviour. M5-4 (security), M5-5 (forklift)
// and M5-6 (butcher) each add one line here. NPCs whose behaviour has no module are not spawned.
// Modules keep per-NPC memory, so each NpcSystem (one per room) gets fresh ones.
import { createSecurityBehaviour } from './security';
import { createStockerBehaviour } from './stocker';
import type { NpcBehaviourModule } from './types';

export function defaultNpcBehaviours(): NpcBehaviourModule[] {
  return [createStockerBehaviour(), createSecurityBehaviour()];
}
