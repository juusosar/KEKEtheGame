import { expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, players, test, toPlay } from './helpers';

// The first-time tutorial: the How to play pages open over the lobby the first time a player enters a
// room, close with Skip / Esc / Let's play, stay closed after that, and open again from the lobby's
// How to play button. Every other spec skips it (toPlay marks it seen).

const tutorial = (page: Page) =>
  page.locator('#keke-lobby-howto').getByRole('dialog', { name: 'How to play' });

test('a new player sees the tutorial over the lobby once; the lobby button opens it again', async ({
  newPlayer,
}) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  await toPlay(host, 'Uusi', '', { tutorial: true });
  await createRoom(host);

  await expect(tutorial(host)).toBeVisible();
  await expect(tutorial(host)).toHaveAttribute('data-variant', 'tutorial');
  await expect(host.locator('body')).toHaveAttribute('data-howto', 'open');
  await expect(host.getByRole('heading', { name: 'New here? How KEKE works' })).toBeVisible();
  // It covers the lobby: the room is still there underneath.
  await expect(players(host)).toHaveCount(1);

  // Paging works here too; Skip closes it and puts focus on Ready.
  await host.keyboard.press('ArrowRight');
  await expect(host.locator('#keke-howto-page')).toHaveAttribute('data-page', 'controls');
  await host.getByRole('button', { name: 'Skip' }).click();
  await expect(tutorial(host)).toHaveCount(0);
  await expect(host.locator('body')).not.toHaveAttribute('data-howto', 'open');
  await expect(host.getByRole('button', { name: 'Ready' })).toBeFocused();

  // The lobby button opens it again; Esc closes it.
  await host.locator('#keke-lobby-howto-open').click();
  await expect(tutorial(host)).toBeVisible();
  await expect(host.getByRole('heading', { name: 'How to play' })).toBeVisible();
  await host.keyboard.press('Escape');
  await expect(tutorial(host)).toHaveCount(0);

  // Leave and make a new room: no tutorial this time.
  await host.getByRole('button', { name: 'Leave room' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'play');
  await createRoom(host);
  await expect(host.locator('#keke-lobby-howto')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("a player joining by code sees it too and can walk it to the end; Let's play closes it", async ({
  newPlayer,
}) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  await toPlay(host, 'Isanta');
  const code = await createRoom(host);
  await expect(host.locator('#keke-lobby-howto')).toHaveCount(0);

  const guest = await newPlayer(pageErrors);
  await toPlay(guest, 'Vieras', '', { tutorial: true });
  await joinRoom(guest, code);
  await expect(tutorial(guest)).toBeVisible();
  for (let i = 0; i < 4; i++) await guest.locator('#keke-howto-next').click();
  await expect(guest.locator('#keke-howto-page')).toHaveAttribute('data-page', 'store2');
  await guest.getByRole('button', { name: "Let's play" }).click();
  await expect(tutorial(guest)).toHaveCount(0);
  const seen = await guest.evaluate(() =>
    (globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem(
      'keke.howToSeen',
    ),
  );
  expect(seen).toBe('1');
  await expect(players(host)).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});
