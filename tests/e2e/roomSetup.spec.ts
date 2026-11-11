import { expect, type Page } from '@playwright/test';
import { joinRoom, openRoomSetup, test, toPlay } from './helpers';

// Host rules: Create room opens the room setup menu (stores, mode, rounds, teams, rules). The lobby
// sums up the changed rules for everyone, the host edits them in an overlay, guests see them read-only,
// and the round plays them (the quota meter shows the host's order size).

const rules = (page: Page) => page.locator('#keke-lobby-rules li');

test('the host sets rules when creating the room and in the lobby; the round plays them', async ({
  newPlayer,
}) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Setter');
  await openRoomSetup(host);
  const setup = host.locator('#keke-setup');
  await setup.getByRole('button', { name: 'Quota + Race' }).click();
  await setup.locator('[data-map-choice="kespro"]').click();
  await setup.getByRole('button', { name: 'Quick' }).click();
  await expect(setup.getByRole('button', { name: 'Quick' })).toHaveAttribute('aria-pressed', 'true');
  await expect(host.getByRole('spinbutton', { name: 'Round time (Timed)' })).toHaveValue('90');
  // Typed values snap to a step and stay in range; the preset no longer matches.
  await host.getByRole('spinbutton', { name: 'Items per order' }).fill('10');
  await host.getByRole('spinbutton', { name: 'Items per order' }).press('Tab');
  await expect(setup.getByRole('button', { name: 'Quick' })).toHaveAttribute('aria-pressed', 'false');
  // Only the round and race groups start open.
  await setup.locator('summary', { hasText: 'The store' }).click();
  await host.getByRole('spinbutton', { name: 'Joke item chance' }).fill('99');
  await host.getByRole('spinbutton', { name: 'Joke item chance' }).press('Tab');
  await expect(host.getByRole('spinbutton', { name: 'Joke item chance' })).toHaveValue('50');
  await host.getByRole('button', { name: 'Open lobby' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  const code = (await host.locator('body').getAttribute('data-room')) ?? '';
  await expect(host.locator('[data-map-choice="kespro"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(host.getByRole('button', { name: 'Quota + Race' })).toHaveAttribute('aria-pressed', 'true');
  await expect(rules(host)).toContainText(['Round time (Timed): 1:30 (standard 3:00)']);
  await expect(rules(host).filter({ hasText: 'Items per order: 10 (standard 6)' })).toHaveCount(1);
  await expect(rules(host).filter({ hasText: 'Joke item chance: 50 %' })).toHaveCount(1);

  await toPlay(guest, 'Watcher');
  await joinRoom(guest, code);
  await expect(rules(guest).filter({ hasText: 'Items per order: 10' })).toHaveCount(1);
  // Guests see every value, read-only.
  await guest.getByRole('button', { name: 'See all rules' }).click();
  const guestQuota = guest.getByRole('spinbutton', { name: 'Items per order' });
  await expect(guestQuota).toHaveValue('10');
  await expect(guestQuota).not.toBeEditable();

  // The host raises the order to 12 in the lobby; the guest's open view follows.
  await host.getByRole('button', { name: 'Edit rules' }).click();
  await host.getByRole('button', { name: 'Raise Items per order' }).click();
  await host.getByRole('button', { name: 'Raise Items per order' }).click();
  await host.getByRole('button', { name: 'Save rules' }).click();
  await expect(rules(host).filter({ hasText: 'Items per order: 12' })).toHaveCount(1);
  await expect(guestQuota).toHaveValue('12');
  await guest.getByRole('button', { name: 'Close' }).click();
  await expect(rules(guest).filter({ hasText: 'Items per order: 12' })).toHaveCount(1);

  // The round's quota meter shows the host's order size.
  await guest.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await expect(host.getByRole('meter', { name: 'Order quota' })).toHaveAttribute('data-quota', '12', {
    timeout: 15_000,
  });
  await expect(guest.getByRole('meter', { name: 'Order quota' })).toHaveAttribute('data-quota', '12');

  expect(pageErrors).toEqual([]);
});

test('the room setup menu remembers the last room and Back returns to Play', async ({ page }) => {
  await toPlay(page, 'Again');
  await openRoomSetup(page);
  await page.getByRole('button', { name: 'Brawl' }).click();
  await page.getByRole('button', { name: 'Rounds per map: 2' }).click();
  await page.getByRole('button', { name: 'Open lobby' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await expect(page.locator('#keke-lobby-rules li').filter({ hasText: 'Health: 50 HP' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Leave room' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');

  await openRoomSetup(page);
  await expect(page.getByRole('button', { name: 'Brawl' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Rounds per map: 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('#keke-setup')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();
});
