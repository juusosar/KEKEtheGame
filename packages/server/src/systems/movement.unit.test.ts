import { Button, defaultThemeId, getTheme, loadConfig } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { loadThemeMap } from '../maps';
import { PlayerState } from '../schema/GameState';
import { MovementSystem } from './movement';

const config = loadConfig();
const map = loadThemeMap(getTheme(defaultThemeId));

describe('MovementSystem button edges', () => {
  it('sees a button still held after a reconnect as a new press (M3 review F6)', () => {
    const movement = new MovementSystem(config, map);
    const player = new PlayerState();
    player.sessionId = 'p1';
    movement.spawn([player]);
    const pressed: number[] = [];
    const hooks = { afterFrame: (_p: PlayerState, _f: unknown, edge: number) => pressed.push(edge) };
    const send = (seq: number, buttons: number) =>
      movement.receive(player, { seq, move: { x: 0, y: 0 }, aim: 0, buttons });

    // One tick per frame: the input credit lets about one frame through per tick.
    send(1, Button.Interact);
    movement.tick([player], hooks);
    send(2, Button.Interact);
    movement.tick([player], hooks);
    expect(pressed).toEqual([Button.Interact, 0]); // held: one press

    movement.resume(player); // the page reloaded while E was down
    send(3, Button.Interact);
    movement.tick([player], hooks);
    expect(pressed).toEqual([Button.Interact, 0, Button.Interact]);
  });
});
