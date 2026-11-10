import { expect } from '@playwright/test';
import { createRoom, joinRoom, players, test, toPlay, waitControlling } from './helpers';

// M3-7: the in-round HUD (§13.2). Two players start a round: each sees the round timer counting down,
// their own target card with the arrow pointing at it, an empty carry slot and a mini scoreboard with
// both players; holding Tab opens the full scoreboard. Offline walk mode (`?scene=game`) has no HUD.
// Selectors here are the contract M3-9's pickup/deposit e2e builds on (see hud/Hud.ts).

test('HUD: timer, target card, arrow, carry slot and scoreboards in a round', async ({ newPlayer }) => {
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
  for (const page of [host, guest]) {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await page.waitForFunction(() => (globalThis as { __KEKE__?: unknown }).__KEKE__ !== undefined);
    await waitControlling(page);
  }

  for (const page of [host, guest]) {
    const timer = page.getByRole('timer', { name: 'Time left' });
    await expect(timer).toBeVisible();
    await expect(timer).toHaveText(/^\d+:\d\d$/);
    const first = Number(await timer.getAttribute('data-seconds'));
    expect(first).toBeGreaterThan(0);
    await expect.poll(async () => Number(await timer.getAttribute('data-seconds'))).toBeLessThan(first);

    const card = page.getByRole('region', { name: 'Your target' });
    await expect(card).toBeVisible();
    await expect(card.locator('.hud-name')).not.toBeEmpty();
    await expect(card.locator('.hud-zone')).not.toBeEmpty();
    await expect(card).toHaveAttribute('data-item-id', /.+/);

    const arrow = page.locator('#keke-hud-arrow');
    await expect(arrow).toBeVisible();
    await expect(arrow).toHaveAttribute('data-kind', 'target');

    const carry = page.getByRole('region', { name: 'Carrying' });
    await expect(carry).toBeVisible();
    await expect(carry).toHaveText(/Empty hands/);
    await expect(carry).toHaveAttribute('data-world-id', '');

    const scores = page.getByRole('list', { name: 'Scores' }).locator('li[data-player-id]');
    await expect(scores).toHaveCount(2);
    await expect(scores.filter({ hasText: 'Hostia' })).toHaveAttribute('data-points', '0');
    await expect(scores.filter({ hasText: 'Vieras' })).toHaveAttribute('data-place', '1');
    await expect(page.locator('#keke-hud-scores li.me')).toHaveCount(1);
  }

  // Full scoreboard while Tab is held.
  const board = host.getByRole('dialog', { name: 'Scoreboard' });
  await expect(board).toBeHidden();
  await host.keyboard.down('Tab');
  await expect(board).toBeVisible();
  await expect(board.locator('tbody tr[data-player-id]')).toHaveCount(2);
  await host.keyboard.up('Tab');
  await expect(board).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test('HUD: offline walk mode has none', async ({ page }) => {
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await expect(page.locator('#keke-debug')).toBeVisible();
  await expect(page.locator('#keke-hud')).toHaveCount(0);
});
