import { expect, test } from '@playwright/test';

// M0 "Done when": the page connects to the server's hello room and shows "connected".
// The Boot scene mirrors its status to <body data-connection="…">, so we wait on that instead of reading the canvas.
test('boot scene joins the hello room', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-connection', 'connected', { timeout: 15_000 });

  expect(pageErrors).toEqual([]);
});
