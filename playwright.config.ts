import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build: the server serves packages/client/dist on one port (§16).
// A separate default port keeps the run from colliding with a dev server on 2567.
const port = Number(process.env['E2E_PORT'] ?? 2568);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm start',
    url: baseURL,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
