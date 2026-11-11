import { expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, mapChoice, players, requireDebugServer, test, toPlay } from './helpers';

// P1-5: the host picks the map in the lobby, every player sees the choice, and the round is played on
// it (round intro, `<body data-map>`). The e2e server runs KEKE_TEST_MAPS=1, so the second map is the
// P1-1 fixture map until the real one is switched on (P1-6); the client draws the default map's tiles
// for a map whose file it does not have yet, under the picked map's name and colours.

const lobbyMap = (page: Page) => page.locator('#keke-lobby');

test('the host picks a map in the lobby and both players play on it', async ({ newPlayer, request }) => {
  await requireDebugServer(request);
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Hostia', '?debug=1');
  const code = await createRoom(host, { map: 'prisma' });
  await toPlay(guest, 'Vieras', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);

  // Both see the pick; only the host can change it.
  for (const page of [host, guest]) {
    await expect(mapChoice(page, 'prisma')).toHaveAttribute('aria-pressed', 'true');
    await expect(mapChoice(page, 'kespro')).toHaveAttribute('aria-pressed', 'false');
    await expect(lobbyMap(page)).toHaveAttribute('data-map', 'prisma');
  }
  await expect(mapChoice(guest, 'kespro')).toBeDisabled();
  await expect(mapChoice(host, 'both')).toBeEnabled();

  // The host changes their mind and back: the guest follows each time.
  await mapChoice(host, 'kespro').click();
  await expect(mapChoice(guest, 'kespro')).toHaveAttribute('aria-pressed', 'true');
  await expect(lobbyMap(guest)).toHaveAttribute('data-map', 'kespro');
  await mapChoice(host, 'prisma').click();
  await expect(mapChoice(guest, 'prisma')).toHaveAttribute('aria-pressed', 'true');

  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();

  await Promise.all(
    [host, guest].map(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma');
      const intro = page.getByRole('dialog', { name: 'Get ready' });
      await expect(intro.locator('.intro-map')).toHaveAttribute('data-map', 'prisma');
      await expect(intro.locator('.intro-map')).not.toHaveText(/wholesale store/);
    }),
  );
  expect(pageErrors).toEqual([]);
});

test('the default map stays the lobby default', async ({ newPlayer }) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  await toPlay(host, 'Hostia');
  await createRoom(host);
  await expect(mapChoice(host, 'kespro')).toHaveAttribute('aria-pressed', 'true');
  await expect(lobbyMap(host)).toHaveAttribute('data-map', 'kespro');
  expect(pageErrors).toEqual([]);
});

test('the offline walk takes its map from ?map=', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.goto('/?scene=game&map=prisma');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma');
  expect(pageErrors).toEqual([]);
});
