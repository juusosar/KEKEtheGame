import { expect, test } from '@playwright/test';

// M2-6: a reload inside the server's reconnect window (§15.3) puts the player back into the same
// room with the same session, skipping the menus. <body data-session> holds our session id.

test('a reload goes straight back into the same room as the same player', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByLabel('Nickname').fill('Reloader');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create room' }).click();
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
