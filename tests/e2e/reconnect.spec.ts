import { expect, test } from '@playwright/test';
import { createRoom, expectSettled, game, toPlay, waitControlling } from './helpers';

// M2-6: a reload inside the server's reconnect window (§15.3) puts the player back into the same
// room with the same session, skipping the menus. <body data-session> holds our session id.

test('a reload goes straight back into the same room as the same player', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  // createRoom re-clicks a lost click (M6 review F3).
  await toPlay(page, 'Reloader');
  await createRoom(page);
  await expect(page.locator('body')).toHaveAttribute('data-room', /^[A-Z]{4}$/, { timeout: 10_000 });
  const body = page.locator('body');
  const code = (await body.getAttribute('data-room')) ?? '';
  const session = (await body.getAttribute('data-session')) ?? '';
  expect(session).not.toBe('');

  await page.reload();
  await expect(body).toHaveAttribute('data-room', code, { timeout: 15_000 });
  await expect(body).toHaveAttribute('data-session', session);
  await expect(body).not.toHaveAttribute('data-scene', 'title');

  expect(pageErrors).toEqual([]);
});

// M2-3: in a running round the local player is predicted and the server acks its inputs; a reload
// mid-round lands straight back in the Game scene (picked by the room's phase, not the lobby).
test('a solo round: the server acks our moves, and a reload mid-round returns to the game', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  const body = page.locator('body');

  await toPlay(page, 'Solo', '?debug=1');
  await createRoom(page);
  await expect(body).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(body).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });

  // Countdown, then the round: we control the player once the phase is 'playing'.
  await waitControlling(page);
  const start = await game(page);

  await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyD');
  await expect
    .poll(async () => (await game(page)).player.x, { timeout: 5_000 })
    .toBeGreaterThan(start.player.x + 20);
  await page.keyboard.up('KeyD');

  // The server ran our inputs: it keeps acking them and agrees with the prediction.
  await expectSettled(page);
  const after = await game(page);
  expect(after.net?.ack).toBeGreaterThan(start.net?.ack ?? 0);

  const session = (await body.getAttribute('data-session')) ?? '';
  await page.reload();
  await expect(body).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await expect(body).toHaveAttribute('data-session', session);
  await waitControlling(page);
  // Same spot as before the reload (the server kept our body), give or take the last unacked step.
  const resumed = await game(page);
  expect(Math.abs(resumed.player.x - after.player.x)).toBeLessThan(8);

  // Moving again after the reload works: the new connection's input seq starts past the old one.
  await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyS');
  await expect
    .poll(async () => (await game(page)).player.y, { timeout: 5_000 })
    .toBeGreaterThan(resumed.player.y + 20);
  await page.keyboard.up('KeyS');
  await expectSettled(page);

  expect(pageErrors).toEqual([]);
});
