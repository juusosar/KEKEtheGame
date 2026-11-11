// On-screen button prompts (§13.3 "Last-used device switches the on-screen button prompts"; M7 review F6).
// Pure: the round state and the last-used device in, the prompts to show out. Hud.ts draws them.
import { inPickupRange, type ReachConfig, type Vec2 } from '@keke/shared';
import type { MessageKey } from '../i18n';
import { buttonName, type ControlAction } from '../input/controls';
import type { InputDevice } from '../input/device';

export interface Prompt {
  action: ControlAction;
  /** Key or button name on the device, e.g. "E" or "A". */
  button: string;
  /** i18n key of what it does here. */
  label: MessageKey;
}

export interface PromptState {
  phase: string;
  /** In the round as a player (not a late joiner watching). */
  playing: boolean;
  alive: boolean;
  /** Our inputs are being simulated (countdown over, not KO'd). */
  controlling: boolean;
  carrying: boolean;
  /** A lying (not carried) item is within pickup reach of our body. */
  itemInReach: boolean;
  /** The held weapon can block (the pan). */
  canBlock: boolean;
  menuOpen: boolean;
}

const prompt = (action: ControlAction, label: MessageKey, device: InputDevice): Prompt => ({
  action,
  button: buttonName(action, device),
  label,
});

/**
 * The prompts for this moment, most useful first:
 * - round intro (countdown): Move, Scores, Menu, so a new player learns the basics while waiting;
 * - in the round: Drop while carrying, otherwise Pick up when an item is in reach; Block while holding
 *   a weapon that blocks;
 * - nothing while the menu is open (it has the whole controls table), when KO'd, spectating or on the
 *   results and podium screens.
 */
export function pickPrompts(state: PromptState, device: InputDevice): Prompt[] {
  if (state.menuOpen || !state.playing) return [];
  if (state.phase === 'countdown') {
    return [
      prompt('move', 'prompt.move', device),
      prompt('scoreboard', 'prompt.scoreboard', device),
      prompt('menu', 'prompt.menu', device),
    ];
  }
  if (state.phase !== 'playing' || !state.alive || !state.controlling) return [];
  const out: Prompt[] = [];
  if (state.carrying) out.push(prompt('drop', 'prompt.drop', device));
  else if (state.itemInReach) out.push(prompt('interact', 'prompt.pickup', device));
  if (state.canBlock) out.push(prompt('block', 'prompt.block', device));
  return out;
}

/** True when any of `items` (lying ones; carried items are left out by the caller) is in pickup reach. */
export function anyInReach(pos: Vec2, items: Iterable<Vec2>, config: ReachConfig): boolean {
  for (const item of items) if (inPickupRange(pos, item, config)) return true;
  return false;
}

/** Stable key of a prompt list, so the HUD rebuilds its row only when something changes. */
export function promptsKey(prompts: readonly Prompt[]): string {
  return prompts.map((p) => `${p.action}:${p.button}`).join('|');
}
