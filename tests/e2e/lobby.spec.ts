import { expect, test, type Page } from '@playwright/test';

// M2-5: the Lobby (§13.1 step 4). After create or join, both players land in the lobby, see each other,
// ready up, the host changes settings that the guest sees, and Start takes both to the Game scene.

async function toPlay(page: Page, nickname: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');
}

const players = (page: Page) => page.getByRole('list', { name: 'Players' }).locator('li');
const row = (page: Page, name: string) => players(page).filter({ hasText: name });

test('host and guest meet in the lobby, ready up, change settings and start', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) page.on('pageerror', (err) => pageErrors.push(err));

  await toPlay(host, 'Hostess');
  await host.getByRole('button', { name: 'Create room' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await expect(host.locator('body')).toHaveAttribute('data-room', /^[A-Z]{4}$/);
  const code = (await host.locator('body').getAttribute('data-room')) ?? '';
  await expect(host.locator('#keke-lobby-code')).toHaveText(code);

  await toPlay(guest, 'Guesto');
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guest.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });

  // Both see both players; the creator is the host.
  for (const page of [host, guest]) {
    await expect(players(page)).toHaveCount(2);
    await expect(row(page, 'Hostess')).toHaveAttribute('data-host', 'true');
    await expect(row(page, 'Guesto')).toHaveAttribute('data-host', 'false');
  }

  // Only the host sees Start and can change settings.
  await expect(guest.getByRole('button', { name: 'Start' })).toBeHidden();
  await expect(guest.getByRole('button', { name: 'Quota + Race' })).toBeDisabled();
  const start = host.getByRole('button', { name: 'Start' });
  await expect(start).toBeDisabled();

  // Host settings reach the guest.
  await host.getByRole('button', { name: 'Quota + Race' }).click();
  await host.getByRole('button', { name: 'Rounds per map: 3' }).click();
  await host.getByRole('button', { name: 'Teams', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Quota + Race' })).toHaveAttribute('aria-pressed', 'true');
  await expect(guest.getByRole('button', { name: 'Rounds per map: 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(guest.getByRole('button', { name: 'Teams', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(row(guest, 'Hostess')).toHaveAttribute('data-team', /^[12]$/);
  await host.getByRole('button', { name: 'Shuffle teams' }).click();

  // Ready-up: the guest's toggle shows on the host's list; Start unlocks only with everyone ready.
  await guest.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(row(host, 'Guesto')).toHaveAttribute('data-ready', 'true');
  await expect(start).toBeDisabled();
  await host.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(start).toBeEnabled();

  await start.click();
  for (const page of [host, guest]) {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await expect(page.locator('body')).toHaveAttribute('data-room', code);
  }

  expect(pageErrors).toEqual([]);
});

test('leaving the lobby goes back to Play', async ({ page }) => {
  await toPlay(page, 'Quitter');
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await expect(players(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Leave room' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');
  await expect(page.locator('body')).not.toHaveAttribute('data-room', /.+/);
});
