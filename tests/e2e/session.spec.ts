import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  game,
  joinRoom,
  players,
  requireDebugServer,
  teleportNear,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M7-1: a whole 3-round Timed session with two players. Round 1 the host deposits and wins; rounds 2 and
// 3 are skipped with the debug end-phase, so both share 1st. The results show the running total and the
// session standing every round, the intro counts the rounds, and the podium puts the host on the top
// step with the guest on the second, then everyone is back in the lobby.
// Needs the e2e server's KEKE_DEBUG=1 (teleport and end phase are debug-only).

type WithHook = { __KEKE__?: KekeHook };

/** Placement points for 1st and 2nd (config placementPoints; Playwright cannot import @keke/shared). */
const FIRST_POINTS = 10;
const SECOND_POINTS = 7;
const ROUNDS = 3;

const hook = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { tile: keke.map.tileSize, items: keke.items(), vans: keke.vans() };
  });

const endPhase = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false);

test('a 3-round session: running totals and standings each round, then the podium', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(150_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Hostia', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Vieras', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  await host.getByRole('button', { name: `Rounds per map: ${ROUNDS}` }).click();
  await expect(guest.getByRole('button', { name: `Rounds per map: ${ROUNDS}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  const forBoth = (check: (page: Page) => Promise<void>) => Promise.all([host, guest].map(check));

  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await expect(page.locator('#keke-intro .intro-round')).toHaveText(`Round 1 of ${ROUNDS}`);
  });
  await forBoth(waitControlling);
  const hostId = (await game(host)).net?.sessionId ?? '';
  const guestId = (await game(guest)).net?.sessionId ?? '';

  // Round 1: the host brings their target to the van (same recipe as round.spec.ts).
  const targetId = (await game(host)).net?.target ?? 0;
  const before = await hook(host);
  const target = before.items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  await expect(async () => {
    await teleportNear(host, { x: target.serverX, y: target.serverY }, before.tile * 0.6);
    await host.keyboard.down('KeyE');
    await host.waitForTimeout(150);
    await host.keyboard.up('KeyE');
    await expect.poll(async () => (await game(host)).net?.carrying, { timeout: 3_000 }).toBe(targetId);
  }).toPass({ timeout: 30_000 });
  const myVan = (await game(host)).net?.van;
  const van = before.vans.find((v) => v.van === myVan);
  if (!van) throw new Error('own van is not drawn');
  await teleportNear(host, { x: van.x, y: van.y }, before.tile);
  await expect.poll(async () => (await game(host)).net?.deposited ?? 0).toBeGreaterThan(0);

  /** Totals [host, guest] and standings [host, guest] expected on the results of `round`. */
  const checkResults = async (round: number, totals: number[], standings: number[]): Promise<void> => {
    await forBoth(async (page) => {
      const results = page.getByRole('dialog', { name: new RegExp(`Round ${round} results`) });
      await expect(results).toBeVisible({ timeout: 12_000 });
      for (const [i, id] of [hostId, guestId].entries()) {
        const row = results.locator(`.results-players tr[data-player-id="${id}"]`);
        await expect(row.locator('.session')).toHaveText(String(totals[i]));
        await expect(row).toHaveAttribute('data-session-place', String(standings[i]));
        await expect(row.locator('.standing')).toHaveText(String(standings[i]));
      }
      await expect(page.locator('#keke-results-next')).toHaveText(
        round < ROUNDS ? /^Next round in \d+ s$/ : /^Podium in \d+ s$/,
      );
    });
  };

  expect(await endPhase(host)).toBe(true);
  await checkResults(1, [FIRST_POINTS, SECOND_POINTS], [1, 2]);

  // Rounds 2 and 3: nobody scores, both share 1st and its points.
  let totals = [FIRST_POINTS, SECOND_POINTS];
  for (let round = 2; round <= ROUNDS; round++) {
    expect(await endPhase(host)).toBe(true); // results → countdown
    await forBoth(async (page) => {
      await expect(page.locator('#keke-intro .intro-round')).toHaveText(`Round ${round} of ${ROUNDS}`, {
        timeout: 12_000,
      });
    });
    expect(await endPhase(host)).toBe(true); // countdown → playing
    await forBoth(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-phase', 'playing', { timeout: 12_000 });
    });
    expect(await endPhase(host)).toBe(true); // playing → results
    totals = totals.map((n) => n + FIRST_POINTS);
    await checkResults(round, totals, [1, 2]);
  }

  // The podium: host on the top step, guest on the second, a winner line on both screens.
  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    const podium = page.getByRole('dialog', { name: 'Session podium' });
    await expect(podium).toBeVisible({ timeout: 12_000 });
    await expect(podium.locator('.podium-rounds')).toHaveText(`After ${ROUNDS} rounds`);
    const top = podium.locator('.podium-step[data-step="1"] li[data-side-id]');
    await expect(top).toHaveCount(1);
    await expect(top).toHaveAttribute('data-side-id', hostId);
    await expect(top).toHaveAttribute('data-points', String(totals[0]));
    await expect(top).toContainText('Hostia');
    await expect(podium.locator('.podium-step[data-step="2"] li[data-side-id]')).toHaveAttribute(
      'data-side-id',
      guestId,
    );
    await expect(podium.locator('.podium-step[data-step="3"] li')).toHaveCount(0);
  });
  await expect(host.locator('.podium-winner')).toHaveText('You win the session!');
  await expect(guest.locator('.podium-winner')).toHaveText('Hostia wins the session!');
  if (process.env['KEKE_SHOT'])
    await host.locator('#keke-podium').screenshot({ path: process.env['KEKE_SHOT'] });

  expect(await endPhase(host)).toBe(true);
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  });
  expect(pageErrors).toEqual([]);
});
