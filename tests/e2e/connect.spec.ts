import { expect, test } from '@playwright/test';

// M0 "Done when": the page reaches the server and shows "connected". Since M3 review F5 the Boot scene
// reads the server's health check (GET /healthz) instead of joining a hello room. It mirrors its status
// to <body data-connection="…">, so we wait on that instead of reading the canvas.
test('boot scene reaches the server health check', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-connection', 'connected', { timeout: 15_000 });

  expect(pageErrors).toEqual([]);
});

test('the health check answers ok', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.ok()).toBe(true);
  // Both maps loaded on the e2e server (P1 review F9).
  expect(await res.json()).toMatchObject({ ok: true, maps: ['kespro', 'prisma'] });
});
