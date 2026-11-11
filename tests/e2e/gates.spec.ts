import { expect, type Page } from '@playwright/test';
import type { KekeGateSnapshot, KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  expectSettled,
  game,
  noNpcs,
  requireDebugServer,
  teleportNear,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// P2-1 (phase 2 decision 9): the self-checkout gates on the second map are one-way. A player walks out of
// the store through a gate lane, is stopped there for a moment, and cannot walk back in the same way.
// Needs the e2e server's KEKE_DEBUG=1 (teleport, no NPCs).

type WithHook = { __KEKE__?: KekeHook };

const gatesOf = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return keke.gates();
  });

test('walks out through a self-checkout gate, is stopped, and cannot walk back in', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  await toPlay(host, 'Hostia', '?debug=1');
  await createRoom(host, { map: 'prisma' });
  await host.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-map', 'prisma', { timeout: 10_000 });
  await waitControlling(host);
  await noNpcs(host);

  const gates = await gatesOf(host);
  expect(gates.filter((g) => g.kind === 'checkout').length).toBeGreaterThan(0);
  expect(gates.some((g) => g.kind === 'door' && g.dir === 'n')).toBe(true);
  const lane = gates.find((g) => g.kind === 'checkout' && g.dir === 's') as KekeGateSnapshot;
  const cx = lane.x + lane.width / 2;
  const lineY = lane.y + lane.height / 2;

  // Inside the store, right in front of the lane.
  await teleportNear(host, { x: cx, y: lineY - 36 }, 0);
  await expectSettled(host);

  // Walk south: the gate stops us on the far side of its line, then lets us go on.
  await host.keyboard.down('KeyS');
  await expect.poll(async () => (await game(host)).net?.gateStop ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  const stoppedAt = (await game(host)).player;
  expect(stoppedAt.y).toBeGreaterThanOrEqual(lineY);
  // The till beeps, a bubble shows over us, and the server's stop event names this gate.
  const gateFx = () =>
    host.evaluate(() => {
      const keke = (globalThis as WithHook).__KEKE__;
      return { gate: keke?.gateFx(), beeps: keke?.sfx()['gateBeep'] ?? 0 };
    });
  await expect.poll(async () => (await gateFx()).gate?.stops.length ?? 0).toBeGreaterThan(0);
  const fx = await gateFx();
  expect(fx.gate?.stops.at(-1)).toMatchObject({ gate: lane.index, carrying: false });
  expect(fx.gate?.bubbles).toContain('Beep! Please wait…');
  expect(fx.gate?.looks.some((l) => l.index === lane.index)).toBe(true);
  expect(fx.beeps).toBeGreaterThan(0);
  await expect.poll(async () => (await game(host)).player.y, { timeout: 5_000 }).toBeGreaterThan(lineY + 40);
  await host.keyboard.up('KeyS');
  await expectSettled(host);
  expect((await game(host)).net?.gateStop).toBe(0);

  // Walk back north: the gate holds us on its line, like a wall, and the server agrees.
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(1_500);
  await host.keyboard.up('KeyW');
  await expectSettled(host);
  const back = (await game(host)).player;
  expect(back.y).toBeGreaterThanOrEqual(lineY - 0.5);
  expect(back.y).toBeLessThan(lineY + 1);
  expect((await game(host)).net?.gateStop).toBe(0);

  expect(pageErrors).toEqual([]);
});
