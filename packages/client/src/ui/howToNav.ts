// Navigation and the "seen it" flag for the How to play pages (ui/howToPlay.ts). Pure, so it is
// unit-tested in node; the HowToPlay DOM class applies the commands.
import type { KeyValueStore } from '../profile/storage';
import { PAD_MENU } from './menuNav';

/** The How to play pages, in order. Each is one tab and one illustrated card. */
export const HOW_TO_PAGES = ['goal', 'controls', 'fight', 'staff', 'store2'] as const;
export type HowToPage = (typeof HOW_TO_PAGES)[number];

/** What a press does on the How to play pages. `next` on the last page closes them. */
export type HowToCommand = 'prev' | 'next' | 'close';

/** Shoulder buttons (standard mapping) page through the tabs as well as the D-pad. */
export const PAD_SHOULDER = { lb: 4, rb: 5 } as const;

/** Commands for the pad buttons pressed this frame: D-pad or LB/RB page, A goes on, B closes. */
export function howToPadCommands(fresh: readonly number[]): HowToCommand[] {
  const out: HowToCommand[] = [];
  for (const i of fresh) {
    if (i === PAD_MENU.left || i === PAD_SHOULDER.lb) out.push('prev');
    else if (i === PAD_MENU.right || i === PAD_SHOULDER.rb || i === PAD_MENU.a) out.push('next');
    else if (i === PAD_MENU.b || i === PAD_MENU.start) out.push('close');
  }
  return out;
}

/**
 * The command for a key press, or null to leave the key alone (Enter and Space on a focused button and
 * Tab work natively).
 */
export function howToKeyCommand(key: { key: string; repeat: boolean }): HowToCommand | null {
  if (key.key === 'Escape') return key.repeat ? null : 'close';
  if (key.key === 'ArrowLeft') return 'prev';
  if (key.key === 'ArrowRight') return 'next';
  return null;
}

/** Page index after a command: clamped (no wrap, so "next" on the last page can mean "done"). */
export function stepPage(index: number, command: 'prev' | 'next'): number {
  const last = HOW_TO_PAGES.length - 1;
  return Math.max(0, Math.min(last, index + (command === 'next' ? 1 : -1)));
}

/** localStorage key: set once the player has closed the first-time tutorial in a lobby. */
export const HOW_TO_SEEN_KEY = 'keke.howToSeen';

/** True when the first-time tutorial was already shown and closed (storage errors count as seen). */
export function howToSeen(store: KeyValueStore | undefined): boolean {
  try {
    return store === undefined || store.getItem(HOW_TO_SEEN_KEY) === '1';
  } catch {
    // Storage that throws would show the tutorial on every join; better not to show it at all.
    return true;
  }
}

/** Remembers that the first-time tutorial was closed. A failing store is ignored. */
export function markHowToSeen(store: KeyValueStore | undefined): void {
  try {
    store?.setItem(HOW_TO_SEEN_KEY, '1');
  } catch {
    // Nothing to do: the tutorial shows again next time.
  }
}
