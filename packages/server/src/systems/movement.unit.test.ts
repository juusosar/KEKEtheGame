import {
  Button,
  NO_GATE_TIMERS,
  applyInput,
  defaultThemeId,
  gateStopFrames,
  getTheme,
  loadConfig,
  type MovementState,
} from '@keke/shared';
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

describe('MovementSystem gates (phase 2 decision 9)', () => {
  const prisma = loadThemeMap(getTheme('prisma'));
  const lane = prisma.gates.find((g) => g.kind === 'checkout');
  if (!lane) throw new Error('prisma has no checkout gate');
  const cx = lane.x + lane.width / 2;
  const lineY = lane.y + lane.height / 2;

  it('writes the gate timers, fires one stop event, and matches a pure replay (what prediction runs)', () => {
    const movement = new MovementSystem(config, prisma);
    const player = new PlayerState();
    player.sessionId = 'p1';
    player.x = cx;
    player.y = lineY - 40;
    const stops: [number, number][] = [];
    const hooks = {
      modifiers: () => ({ carrying: true }),
      onGateStop: (_p: PlayerState, gate: number, frames: number) => stops.push([gate, frames]),
    };
    let replay: MovementState = { x: player.x, y: player.y, vx: 0, vy: 0, gate: NO_GATE_TIMERS };
    for (let seq = 1; seq <= 80; seq++) {
      const frame = { seq, move: { x: 0, y: 1 }, aim: 0, buttons: 0 };
      movement.receive(player, frame);
      movement.tick([player], hooks);
      replay = applyInput(replay, frame, prisma, config, { carrying: true });
      expect({ x: player.x, y: player.y, stop: player.gateStop, cd: player.gateCooldown }).toEqual({
        x: replay.x,
        y: replay.y,
        stop: replay.gate?.stop,
        cd: replay.gate?.cooldown,
      });
    }
    expect(stops).toEqual([[lane.index, gateStopFrames('checkout', true, config)]]);
    expect(player.gateLast).toBe(lane.index);
    expect(player.y).toBeGreaterThan(lineY + 32);
  });

  it('spawn clears the timers', () => {
    const movement = new MovementSystem(config, prisma);
    const player = new PlayerState();
    player.gateStop = 5;
    player.gateLast = 2;
    player.gateCooldown = 50;
    movement.spawn([player]);
    expect([player.gateStop, player.gateLast, player.gateCooldown]).toEqual([0, -1, 0]);
  });
});
