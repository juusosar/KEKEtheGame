import { expect, type Page } from '@playwright/test';
import { joinRoom, openRoomSetup, remoteSeen, test, toPlay, waitControlling } from './helpers';

// Bot players: the host sets how many bots and how good they are in the room setup menu and in the
// lobby. Bots show in the player list with a "bot" tag, are always ready, and walk around in the round.

const botRows = (page: Page) => page.locator('#keke-lobby li[data-bot="true"]');

test('the host adds bots in the setup menu and the lobby; they are ready and play the round', async ({
  newPlayer,
}) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Boss', '?debug=1');
  await openRoomSetup(host);
  const setup = host.locator('#keke-setup');
  await setup.locator('[data-map-choice="kespro"]').click();
  await setup.getByRole('button', { name: 'More bots' }).click();
  await setup.getByRole('button', { name: 'More bots' }).click();
  await expect(setup.getByRole('spinbutton', { name: 'Bots' })).toHaveValue('2');
  await setup.getByRole('button', { name: 'Hard' }).click();
  await expect(setup.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true');
  await host.getByRole('button', { name: 'Open lobby' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  const code = (await host.locator('body').getAttribute('data-room')) ?? '';

  // Two bots, ready, tagged; the lobby shows the setting.
  await expect(botRows(host)).toHaveCount(2);
  await expect(botRows(host).first()).toHaveAttribute('data-ready', 'true');
  await expect(botRows(host).first()).toContainText('bot');
  const lobby = host.locator('#keke-lobby');
  await expect(lobby.getByRole('spinbutton', { name: 'Bots' })).toHaveValue('2');
  await expect(lobby.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true');

  // The host adds one more from the lobby; the guest sees it, read-only.
  await lobby.getByRole('button', { name: 'More bots' }).click();
  await expect(botRows(host)).toHaveCount(3);
  await toPlay(guest, 'Pal', '?debug=1');
  await joinRoom(guest, code);
  await expect(botRows(guest)).toHaveCount(3);
  const guestLobby = guest.locator('#keke-lobby');
  await expect(guestLobby.getByRole('spinbutton', { name: 'Bots' })).toHaveValue('3');
  await expect(guestLobby.getByRole('button', { name: 'More bots' })).toBeDisabled();
  await expect(guestLobby.getByRole('button', { name: 'Easy' })).toBeDisabled();

  const name = (await botRows(guest).first().locator('.name').textContent()) ?? '';
  expect(name).not.toBe('');

  // Only the two people need to ready up.
  await guest.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await waitControlling(host);

  // A bot walks off from its van.
  await expect.poll(async () => remoteSeen(host, name), { timeout: 5_000 }).not.toBeNull();
  const start = await remoteSeen(host, name);
  await expect
    .poll(
      async () => {
        const now = await remoteSeen(host, name);
        return start && now ? Math.hypot(now.x - start.x, now.y - start.y) : 0;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(64);

  expect(pageErrors).toEqual([]);
});
