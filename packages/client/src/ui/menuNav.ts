// Gamepad and keyboard navigation for the in-game menu (F5). Pure, so it is unit-tested in node; the
// GameMenu DOM class applies the commands.
import { STANDARD } from '../input/gamepad';

/**
 * What a press does in the menu. `menu` is Esc / Start: opens a closed menu, otherwise goes back one
 * step (the leave confirmation → the menu → closed). `back` is pad B: back one step, never opens.
 */
export type MenuCommand = 'menu' | 'back' | 'prev' | 'next' | 'dec' | 'inc' | 'activate';

/** W3C standard mapping indices the menu reads on top of gamepad.ts's game buttons. */
export const PAD_MENU = {
  a: STANDARD.buttons.a,
  b: STANDARD.buttons.b,
  start: STANDARD.buttons.start,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** Turns "held" button readings into "just pressed" ones, so one press is one command. */
export class PadEdges {
  private held: readonly boolean[] = [];

  /** Feeds this frame's pressed flags (index = button); returns the indices pressed since the last call. */
  update(pressed: readonly boolean[]): number[] {
    const fresh: number[] = [];
    pressed.forEach((down, i) => {
      if (down && !this.held[i]) fresh.push(i);
    });
    this.held = [...pressed];
    return fresh;
  }

  /** Forget held buttons (a pad that disconnected, or a menu that just closed). */
  reset(): void {
    this.held = [];
  }
}

/**
 * Commands for the buttons pressed this frame. While the menu is closed only Start counts, so A/B/D-pad
 * keep their game meaning.
 */
export function padCommands(fresh: readonly number[], open: boolean): MenuCommand[] {
  const out: MenuCommand[] = [];
  for (const i of fresh) {
    if (i === PAD_MENU.start) out.push('menu');
    else if (!open) continue;
    else if (i === PAD_MENU.b) out.push('back');
    else if (i === PAD_MENU.a) out.push('activate');
    else if (i === PAD_MENU.up) out.push('prev');
    else if (i === PAD_MENU.down) out.push('next');
    else if (i === PAD_MENU.left) out.push('dec');
    else if (i === PAD_MENU.right) out.push('inc');
  }
  return out;
}

/**
 * The command for a key press, or null when the menu leaves the key alone (Enter/Space on a focused
 * button, arrows on a focused slider work natively). Tab is handled here because the game captures it
 * for the scoreboard.
 */
export function keyCommand(
  key: { key: string; shiftKey: boolean; repeat: boolean },
  open: boolean,
): MenuCommand | null {
  if (key.key === 'Escape') return key.repeat ? null : 'menu';
  if (!open) return null;
  if (key.key === 'Tab') return key.shiftKey ? 'prev' : 'next';
  if (key.key === 'ArrowUp') return 'prev';
  if (key.key === 'ArrowDown') return 'next';
  return null;
}

/** Index after moving `delta` from `index` among `count` entries, wrapping; -1 → first or last. */
export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (index < 0) return delta >= 0 ? 0 : count - 1;
  return (((index + delta) % count) + count) % count;
}
