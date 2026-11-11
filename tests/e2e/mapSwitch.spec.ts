import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  game,
  joinRoom,
  noNpcs,
  players,
  requireDebugServer,
  roundAccents,
  THEME_PRIMARY,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// P3-2: a session on both maps (one round each). Round 1 plays on the first map; at the countdown of
// round 2 both clients rebuild the Game scene for the second map without leaving the room (map, music,
// intro "New store"), a reload in round 2 comes back on the second map, the results name each round's
// map and the podium lists both, then the lobby shows the first map again.
// Needs the e2e server's KEKE_DEBUG=1 (end phase, no NPCs).

type WithHook = { __KEKE__?: KekeHook };

/** Map sizes in px: maps/kespro.tmj 96 x 64 and maps/prisma.tmj 96 x 60 tiles of 32 px. */
const KESPRO_PX = { width: 3072, height: 2048 };
const PRISMA_PX = { width: 3072, height: 1920 };

const hook = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { map: keke.map, music: keke.music() };
  });

const endPhase = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false);

test('a session on both maps switches the map between rounds without leaving the room', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);
  const both = [host, guest];
  const forBoth = (check: (page: Page) => Promise<void>) => Promise.all(both.map(check));

  await toPlay(host, 'Hostia', '?debug=1');
  const code = await createRoom(host, { map: 'both' });
  await toPlay(guest, 'Vieras', '?debug=1');
  await joinRoom(guest, code);
  for (const page of both) await expect(players(page)).toHaveCount(2);
  // One round per map: 2 rounds.
  await expect(host.getByRole('button', { name: 'Rounds per map: 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const page of both) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();

  // Round 1 on the first map: no "new store" line.
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await expect(page.locator('body')).toHaveAttribute('data-map', 'kespro');
    const intro = page.getByRole('dialog', { name: 'Get ready' });
    await expect(intro.locator('.intro-round')).toHaveText('Round 1 of 2');
    await expect(intro.locator('.intro-map')).toHaveAttribute('data-map', 'kespro');
    await expect(intro.locator('.intro-new-map')).toHaveCount(0);
  });
  await forBoth(waitControlling);
  await noNpcs(host);
  const before = await hook(host);
  expect(before.map.widthPx).toBe(KESPRO_PX.width);
  expect(before.music).toMatch(/kespro_loop\.wav$/);
  expect(await roundAccents(host)).toEqual([THEME_PRIMARY.kespro, THEME_PRIMARY.kespro]);

  // Results of round 1 name the first map.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'roundResults');
    await expect(page.locator('#keke-results .results-map')).toHaveAttribute('data-map', 'kespro');
  });

  // Round 2: both clients switch to the second map in the same room.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma', { timeout: 10_000 });
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game');
    await expect(page.locator('body')).toHaveAttribute('data-room', code);
    const intro = page.getByRole('dialog', { name: 'Get ready' });
    await expect(intro.locator('.intro-round')).toHaveText('Round 2 of 2');
    await expect(intro.locator('.intro-map')).toHaveAttribute('data-map', 'prisma');
    // One store line that says it is new (P2 review F3): the store is not named twice.
    await expect(intro.locator('.intro-map')).toHaveCount(1);
    await expect(intro.locator('.intro-map.intro-new-map')).toHaveText(/^New store: .+ supermarket!$/);
  });
  await forBoth(waitControlling);
  await forBoth(async (page) => {
    const after = await hook(page);
    expect({ width: after.map.widthPx, height: after.map.heightPx }).toEqual(PRISMA_PX);
    expect(after.music).toMatch(/prisma_loop\.wav$/);
    // The rebuilt HUD and menu follow the new map's colour (P1 review F2).
    expect(await roundAccents(page)).toEqual([THEME_PRIMARY.prisma, THEME_PRIMARY.prisma]);
    // Everyone starts at their van, which stands in the parking lot on this map (south of y 44 tiles).
    const { player } = await game(page);
    expect(player.y).toBeGreaterThan(44 * after.map.tileSize);
  });

  // A reload in the second round comes back to the same room on the second map.
  const guestSession = (await guest.locator('body').getAttribute('data-session')) ?? '';
  await guest.reload();
  await expect(guest.locator('body')).toHaveAttribute('data-room', code, { timeout: 15_000 });
  await expect(guest.locator('body')).toHaveAttribute('data-session', guestSession);
  await expect(guest.locator('body')).toHaveAttribute('data-map', 'prisma', { timeout: 10_000 });
  await waitControlling(guest);
  expect((await hook(guest)).map.widthPx).toBe(PRISMA_PX.width);

  // Results of round 2 name the second map; the podium lists both.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'roundResults');
    await expect(page.locator('#keke-results .results-map')).toHaveAttribute('data-map', 'prisma');
  });
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    const maps = page.locator('#keke-podium .podium-maps li');
    await expect(maps).toHaveCount(2);
    await expect(maps.nth(0)).toHaveAttribute('data-map', 'kespro');
    await expect(maps.nth(0)).toHaveText(/^Round 1: /);
    await expect(maps.nth(1)).toHaveAttribute('data-map', 'prisma');
    await expect(maps.nth(1)).toHaveText(/^Round 2: /);
  });

  // Back in the lobby the next session starts on the first map again.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
    await expect(page.locator('#keke-lobby')).toHaveAttribute('data-map', 'kespro');
  });
  expect(pageErrors).toEqual([]);
});
