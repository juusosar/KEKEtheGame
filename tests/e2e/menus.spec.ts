import { expect, type Page } from '@playwright/test';
import { test, toPlay } from './helpers';

// M2-4: Title → Profile → Play (§13.1). The menu scenes are HTML over the canvas, and each mirrors itself
// to <body data-scene="…">. Once a room is entered, <body data-room="ABCD"> holds its code.

async function toProfile(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'profile');
}

test('the profile is picked on the Profile screen and kept in localStorage', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await toProfile(page);
  await page.getByLabel('Nickname').fill('  Mikko  ');
  await page.getByRole('button', { name: 'Colour #E53935' }).click();
  await page.getByRole('button', { name: 'Hard hat' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');
  await expect(page.getByText('Playing as Mikko')).toBeVisible();
  const stored = await page.evaluate(() =>
    (globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem(
      'keke.profile',
    ),
  );
  expect(JSON.parse(stored ?? '{}')).toEqual({ nickname: 'Mikko', color: '#E53935', hat: 'hardhat' });

  // After a reload the Profile screen starts from the saved choice.
  await toProfile(page);
  await expect(page.getByLabel('Nickname')).toHaveValue('Mikko');
  await expect(page.getByRole('button', { name: 'Colour #E53935' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Hard hat' })).toHaveAttribute('aria-pressed', 'true');

  expect(pageErrors).toEqual([]);
});

test('an unknown room code shows an error and stays on Play', async ({ page }) => {
  await toPlay(page, 'Lost');
  await page.getByLabel('Room code').fill('zzzz');
  await expect(page.getByLabel('Room code')).toHaveValue('ZZZZ');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('No open room with the code ZZZZ.', { timeout: 10_000 });
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');
});

test('one player creates a room; others join it by code and from the room list', async ({ newPlayer }) => {
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const byCode = await newPlayer(pageErrors);
  const byList = await newPlayer(pageErrors);

  // The list player opens Play first, so the new room has to arrive through the live listing.
  await toPlay(byList, 'Lister');
  await toPlay(host, 'Hostess');
  await host.getByRole('button', { name: 'Create room' }).click();
  await host.getByRole('button', { name: 'Open lobby' }).click();
  await expect(host.locator('body')).toHaveAttribute('data-room', /^[A-Z]{4}$/, { timeout: 10_000 });
  const code = (await host.locator('body').getAttribute('data-room')) ?? '';

  await toPlay(byCode, 'Coder');
  await byCode.getByLabel('Room code').fill(code.toLowerCase());
  await byCode.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(byCode.locator('body')).toHaveAttribute('data-room', code, { timeout: 10_000 });

  const row = byList.locator(`li[data-room-code="${code}"]`);
  await expect(row).toContainText('Hostess', { timeout: 10_000 });
  await byList.getByRole('button', { name: `Join ${code}` }).click();
  await expect(byList.locator('body')).toHaveAttribute('data-room', code, { timeout: 10_000 });

  expect(pageErrors).toEqual([]);
});
