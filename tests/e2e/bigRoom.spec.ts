import { expect, type Locator, type Page } from '@playwright/test';
import { openRoomSetup, test, toPlay, waitControlling } from './helpers';

// 16 players per room: one person and 15 bots fill a room. Everyone gets their own colour, and the
// lobby list, the round results (Race with Teams, the tallest table) and the podium fit a 720p screen.

type WithHook = { __KEKE__?: { endPhase(): boolean } };
const endPhase = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false);

/** The panel shows all of its content without scrolling, inside the viewport. */
async function fitsScreen(panel: Locator): Promise<void> {
  await expect(panel).toBeVisible();
  const fit = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      overflow: el.scrollHeight - el.clientHeight,
      top: r.top,
      bottom: r.bottom,
      vh: (globalThis as unknown as { innerHeight: number }).innerHeight,
    };
  });
  expect(fit.overflow).toBeLessThanOrEqual(1);
  expect(fit.top).toBeGreaterThanOrEqual(0);
  expect(fit.bottom).toBeLessThanOrEqual(fit.vh);
}

test.use({ viewport: { width: 1280, height: 720 } });

test('a full room of 16: own colours, and the lobby, results and podium fit 720p', async ({ newPlayer }) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  await host.setViewportSize({ width: 1280, height: 720 });

  await toPlay(host, 'Boss', '?debug=1');
  await openRoomSetup(host);
  const setup = host.locator('#keke-setup');
  await setup.locator('[data-map-choice="kespro"]').click();
  const bots = setup.getByRole('spinbutton', { name: 'Bots' });
  await bots.fill('15');
  await bots.press('Tab');
  await expect(bots).toHaveValue('15');
  await host.getByRole('button', { name: 'Open lobby' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });

  const lobby = host.locator('#keke-lobby');
  await lobby.getByRole('button', { name: 'Quota + Race' }).click();
  await lobby.getByRole('button', { name: 'Teams', exact: true }).click();
  const rows = lobby.getByRole('list', { name: 'Players' }).locator('li');
  await expect(rows).toHaveCount(16);
  await expect(lobby.getByRole('list', { name: 'Players' })).toHaveClass(/\bmany\b/);
  // Every row and the Ready button are on screen without scrolling.
  for (const row of await rows.all()) await expect(row).toBeInViewport({ ratio: 1 });
  await expect(host.getByRole('button', { name: 'Ready' })).toBeInViewport({ ratio: 1 });
  const colors = await rows
    .locator('.swatch-dot')
    .evaluateAll((dots) =>
      dots.map((d) => (d as unknown as { style: { background: string } }).style.background),
    );
  expect(new Set(colors).size).toBe(16);

  await host.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await waitControlling(host);

  // Round results: 16 player rows and both team rows.
  await expect.poll(() => endPhase(host), { timeout: 15_000 }).toBe(true);
  const results = host.locator('#keke-results');
  await expect(results.locator('.results-players tbody tr')).toHaveCount(16, { timeout: 10_000 });
  await fitsScreen(results);

  // Podium (one round per map by default).
  expect(await endPhase(host)).toBe(true);
  const podium = host.locator('#keke-podium');
  await expect(podium).toBeVisible({ timeout: 10_000 });
  await fitsScreen(podium);

  expect(pageErrors).toEqual([]);
});
