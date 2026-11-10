import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build: the server serves packages/client/dist on one port (§16).
// A separate default port keeps the run from colliding with a dev server on 2567.
const port = Number(process.env['E2E_PORT'] ?? 2568);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // No automatic retries: local runs are the merge gate, and a retry would report a flaky spec as a
  // pass. Use --retries=1 on the command line when wanted (M2 review F6).
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm start',
    url: baseURL,
    // KEKE_DEBUG=1 turns on the debug-only room messages (teleport, end phase) that round.spec.ts uses
    // to script a pickup and a deposit and to skip the 180 s round. Never set on a real server.
    env: { PORT: String(port), KEKE_DEBUG: '1' },
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
