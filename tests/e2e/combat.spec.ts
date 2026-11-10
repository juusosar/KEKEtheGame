import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
<<<<<<< HEAD
import {
  createRoom,
  game,
  joinRoom,
  players,
  requireDebugServer,
  test,
  toPlay,
  waitControlling,
} from './helpers';
=======
import { aimMouse, createRoom, game, joinRoom, players, test, toPlay, waitControlling } from './helpers';
>>>>>>> origin/main

// M4-2: melee in a real round. Two players stand next to each other in the store (debug teleport), the
// host aims at the guest with the mouse and clicks: one fist swing lands on the server, both clients see
// the guest's HP drop and the `attack`/`hit` broadcasts. Needs the e2e server's KEKE_DEBUG=1.

type WithHook = { __KEKE__?: KekeHook };

/** Fists damage and max HP (weapons.json / config.json; Playwright specs cannot import @keke/shared). */
const FIST_DAMAGE = 5;
const MAX_HP = 100;

const keke = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    if (!k) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { tile: k.map.tileSize, items: k.items(), player: k.player(), events: k.combatEvents() };
  });

/** Teleports next to `at` (first free spot on a ring of radius `reach`) and waits until we are there. */
async function teleportNear(page: Page, at: { x: number; y: number }, reach: number) {
  const spot = await page.evaluate(
    ({ x, y, reach }) => {
      const k = (globalThis as WithHook).__KEKE__;
      if (!k) throw new Error('window.__KEKE__ is missing');
      const offsets: [number, number][] = [[0, 0]];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        offsets.push([Math.cos(a) * reach, Math.sin(a) * reach]);
      }
      for (const [dx, dy] of offsets) {
        if (k.teleport(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
      return null;
    },
    { ...at, reach },
  );
  expect(spot, 'a free spot next to the destination').not.toBeNull();
  await expect
    .poll(async () => {
      const p = (await keke(page)).player;
      return Math.hypot(p.x - (spot?.x ?? 0), p.y - (spot?.y ?? 0));
    })
    .toBeLessThan(2);
  return spot as { x: number; y: number };
}

test('a fist swing hits the player in front: HP drops on both screens', async ({ newPlayer, request }) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Lyoja', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Kohde', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await Promise.all(
    [host, guest].map(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await waitControlling(page);
    }),
  );

  const guestId = (await game(guest)).net?.sessionId ?? '';
  for (const page of [host, guest]) {
    const net = (await game(page)).net;
    expect(net?.hp).toBe(MAX_HP);
    expect(net?.weapon).toBe('fists');
    expect(net?.alive).toBe(true);
  }

  // Meet in the store, away from the dock (the camera is centred on us there, not clamped to the map edge).
  const hostView = await keke(host);
  const targetId = (await game(host)).net?.target ?? 0;
  const target = hostView.items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  const at = await teleportNear(host, { x: target.serverX, y: target.serverY }, hostView.tile * 1.5);
  // The guest stands about 22 px to our right (fists reach 28 px + body radius).
  const guestAt = await teleportNear(guest, { x: at.x + 22, y: at.y }, 4);
  await host.waitForTimeout(500); // camera catches up

  // Aim at the guest from where we are on screen and click once.
  await aimMouse(host, at, guestAt);
  await host.waitForTimeout(100);
  await host.mouse.down();
  await host.waitForTimeout(120);
  await host.mouse.up();

  await expect.poll(async () => (await game(guest)).net?.hp).toBe(MAX_HP - FIST_DAMAGE);
  await expect
    .poll(async () => (await game(host)).remotes.find((r) => r.id === guestId)?.hp)
    .toBe(MAX_HP - FIST_DAMAGE);
  for (const page of [host, guest]) {
    const types = (await keke(page)).events.map((e) => e.type);
    expect(types).toContain('attack');
    expect(types).toContain('hit');
  }
  expect(pageErrors).toEqual([]);
});
