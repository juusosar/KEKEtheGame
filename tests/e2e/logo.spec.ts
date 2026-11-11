import { expect } from '@playwright/test';
import { test } from './helpers';

// The game's logo: drawn on the title screen and used as the browser tab icon, with the game's name as the
// tab title.

test('the title screen loads the logo, and the tab shows the name and the icon', async ({
  page,
  request,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  const logoLoads: number[] = [];
  page.on('response', (res) => {
    if (res.url().endsWith('/assets/logo.svg')) logoLoads.push(res.status());
  });

  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await expect(page).toHaveTitle('KEKE the Game');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/assets/logo.svg');

  // The title scene fetched the logo for its canvas, and the server serves it as an SVG.
  expect(logoLoads.length).toBeGreaterThan(0);
  expect(logoLoads.every((status) => status === 200 || status === 304)).toBe(true);
  const served = await request.get('/assets/logo.svg');
  expect(served.ok()).toBe(true);
  expect(served.headers()['content-type']).toContain('image/svg+xml');
  expect(pageErrors).toEqual([]);
});
