import { expect } from '@playwright/test';
import { createRoom, test, toPlay } from './helpers';

// M2-6 / §13.1: someone who joins a running round spectates it until the next round. The server side
// is covered by GameRoom.test.ts and Reconnect.test.ts; this checks the Game scene's spectator glue
// (banner, <body data-spectating> following a player). Becoming a player at the next countdown waits
// for the whole round, so it is left to the server tests.
test('a late joiner lands in the running round as a spectator watching the host', async ({ newPlayer }) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  await toPlay(host, 'Hosty');
  const code = await createRoom(host);
  await host.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  const hostSession = (await host.locator('body').getAttribute('data-session')) ?? '';
  expect(hostSession).not.toBe('');

  const late = await newPlayer(pageErrors);
  await toPlay(late, 'Latecomer');
  await late.getByLabel('Room code').fill(code);
  await late.getByRole('button', { name: 'Join', exact: true }).click();
  const body = late.locator('body');
  await expect(body).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await expect(body).toHaveAttribute('data-room', code);
  await expect(late.locator('#keke-spectate')).toBeVisible({ timeout: 10_000 });
  await expect(late.locator('#keke-spectate')).toContainText('Hosty');
  await expect(body).toHaveAttribute('data-spectating', hostSession);

  // The host is playing, not spectating.
  await expect(host.locator('#keke-spectate')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
