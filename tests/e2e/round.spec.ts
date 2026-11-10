import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  E2E_COUNTDOWN_SECONDS,
  createRoom,
  game,
  joinRoom,
  players,
  requireDebugServer,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M3-9: a whole Timed round, start to finish, with two players. The Round intro shows the 3-2-1, the
// host picks up their target and brings it to their van through the debug teleport, both clients'
// scoreboards and feeds show the deposit, then the debug end-phase skips the clock to the Round results
// and the Session podium, and everyone is back in the lobby.
// Needs the e2e server's KEKE_DEBUG=1 (playwright.config.ts): teleport and end phase are debug-only.
// Phase windows are checked on both pages at once (forBoth), never one page after the other (M3 review F2).

type WithHook = { __KEKE__?: KekeHook };

/** Placement points for 1st and 2nd (config placementPoints; Playwright cannot import @keke/shared). */
const FIRST_POINTS = 10;
const SECOND_POINTS = 7;

const hook = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { tile: keke.map.tileSize, items: keke.items(), vans: keke.vans(), player: keke.player() };
  });

/**
 * Asks the server to move us next to `at`, trying spots around it until one is free of walls (the
 * hook checks the map locally), then waits until our predicted body is there.
 */
async function teleportNear(page: Page, at: { x: number; y: number }, reach: number): Promise<void> {
  const spot = await page.evaluate(
    ({ x, y, reach }) => {
      const keke = (globalThis as WithHook).__KEKE__;
      if (!keke) throw new Error('window.__KEKE__ is missing');
      const offsets: [number, number][] = [[0, 0]];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        offsets.push([Math.cos(a) * reach, Math.sin(a) * reach]);
      }
      for (const [dx, dy] of offsets) {
        if (keke.teleport(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
      return null;
    },
    { ...at, reach },
  );
  expect(spot, 'a free spot next to the destination').not.toBeNull();
  await expect
    .poll(async () => {
      const p = (await hook(page)).player;
      return Math.hypot(p.x - (spot?.x ?? 0), p.y - (spot?.y ?? 0));
    })
    .toBeLessThan(2);
}

const endPhase = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false);

test('a Timed round: intro, scripted pickup and deposit, results, podium', async ({ newPlayer, request }) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Hostia', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Vieras', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  // Per-page checks run on both pages at once, so a slow page cannot eat the other's phase window.
  const forBoth = (check: (page: Page) => Promise<void>) => Promise.all([host, guest].map(check));

  // Round intro: map, mode, round 1 of 1 and the countdown on both screens. The intro only lasts the
  // countdown, so both pages are checked at the same time (M3 review F2), not one after the other.
  const countPattern = new RegExp(`^[1-${E2E_COUNTDOWN_SECONDS}]$`);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    const intro = page.getByRole('dialog', { name: 'Get ready' });
    await expect(intro).toBeVisible();
    await expect(intro.locator('.intro-map')).toHaveText(/wholesale store/);
    await expect(intro.locator('.intro-mode')).toHaveText('Timed');
    await expect(intro.locator('.intro-round')).toHaveText('Round 1 of 1');
    const count = page.getByRole('timer', { name: 'Round starts in' });
    await expect(count).toHaveAttribute('data-seconds', countPattern);
    await expect(count).toHaveText(countPattern);
  });
  await forBoth(async (page) => {
    await waitControlling(page);
    await expect(page.locator('#keke-intro')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'playing');
  });

  const hostId = (await game(host)).net?.sessionId ?? '';
  const guestId = (await game(guest)).net?.sessionId ?? '';
  expect(hostId).not.toBe('');

  // Pick up our own target: stand next to it and press E.
  const targetId = (await game(host)).net?.target ?? 0;
  expect(targetId).toBeGreaterThan(0);
  const before = await hook(host);
  const target = before.items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  await teleportNear(host, { x: target.serverX, y: target.serverY }, before.tile * 0.6);
  // Hold E for a few input steps so a fixed-step sample sees it.
  await host.keyboard.down('KeyE');
  await host.waitForTimeout(150);
  await host.keyboard.up('KeyE');
  await expect.poll(async () => (await game(host)).net?.carrying).toBe(targetId);
  await expect(host.getByRole('region', { name: 'Carrying' })).toHaveAttribute(
    'data-world-id',
    String(targetId),
  );

  // Bring it to our van: the deposit is automatic within range.
  const net = (await game(host)).net;
  const van = before.vans.find((v) => v.van === net?.van);
  if (!van) throw new Error(`van ${net?.van} is not drawn`);
  await teleportNear(host, { x: van.x, y: van.y }, before.tile);
  await expect.poll(async () => (await game(host)).net?.deposited ?? 0).toBeGreaterThan(0);
  const deposited = (await game(host)).net?.deposited ?? 0;
  expect((await game(host)).net?.carrying).toBe(0);

  // Both scoreboards and feeds show it.
  await forBoth(async (page) => {
    const scores = page.getByRole('list', { name: 'Scores' });
    await expect(scores.locator(`li[data-player-id="${hostId}"]`)).toHaveAttribute(
      'data-points',
      String(deposited),
    );
    await expect(scores.locator(`li[data-player-id="${hostId}"]`)).toHaveAttribute('data-place', '1');
    await expect(scores.locator(`li[data-player-id="${guestId}"]`)).toHaveAttribute('data-points', '0');
    await expect(scores.locator(`li[data-player-id="${guestId}"]`)).toHaveAttribute('data-place', '2');
    await expect(page.locator('#keke-hud-feed li[data-kind="deposit"]')).toHaveCount(1);
  });

  // Skip the rest of the clock: Round results on both screens.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    const results = page.getByRole('dialog', { name: /Round 1 results/ });
    await expect(results).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'roundResults');
    await expect(page.locator('#keke-hud')).toBeHidden();
    const rows = results.locator('.results-players tbody tr[data-player-id]');
    await expect(rows).toHaveCount(2);
    // Winner first.
    await expect(rows.first()).toHaveAttribute('data-player-id', hostId);
    const first = results.locator(`tr[data-player-id="${hostId}"]`);
    await expect(first).toHaveAttribute('data-place', '1');
    await expect(first.locator('.player')).toHaveText('Hostia');
    await expect(first.locator('.items')).toHaveText(String(deposited));
    await expect(first.locator('.round-points')).toHaveText(`+${FIRST_POINTS}`);
    await expect(first.locator('.session')).toHaveText(String(FIRST_POINTS));
    const second = results.locator(`tr[data-player-id="${guestId}"]`);
    await expect(second).toHaveAttribute('data-place', '2');
    await expect(second.locator('.items')).toHaveText('0');
    await expect(second.locator('.round-points')).toHaveText(`+${SECOND_POINTS}`);
    await expect(second.locator('.session')).toHaveText(String(SECOND_POINTS));
    // One round per map: the podium is next.
    await expect(page.locator('#keke-results-next')).toHaveText(/^Podium in \d+ s$/);
    expect(Number(await page.locator('#keke-results-next').getAttribute('data-seconds'))).toBeGreaterThan(0);
  });

  // Session podium, then everyone is back in the lobby.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    const podium = page.getByRole('dialog', { name: 'Session podium' });
    // The podium phase lasts 15 s; a page drawing a few fps can take more than the default 5 s to show it.
    await expect(podium).toBeVisible({ timeout: 12_000 });
    const sides = podium.locator('li[data-side-id]');
    await expect(sides).toHaveCount(2);
    await expect(sides.first()).toHaveAttribute('data-side-id', hostId);
    await expect(sides.first()).toHaveAttribute('data-place', '1');
    await expect(sides.first()).toContainText('Hostia');
  });
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
    await expect(page.locator('#keke-round')).toHaveCount(0);
  });

  expect(pageErrors).toEqual([]);
});
