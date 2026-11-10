import { fileURLToPath } from 'node:url';
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
  // Specs that start a round wait out the e2e countdown (config.e2e.json) on top of menus and joins; on a
  // busy machine with 2 workers the pages draw at under 10 fps, so 30 s is too tight.
  timeout: 60_000,
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
    // KEKE_CONFIG merges tests/e2e/config.e2e.json over config.json: a longer countdown, so the intro
    // checks do not depend on machine speed (M3 review F2). Specs copy those values (they cannot import it).
    env: {
      PORT: String(port),
      KEKE_DEBUG: '1',
      KEKE_CONFIG: fileURLToPath(new URL('tests/e2e/config.e2e.json', import.meta.url)),
    },
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
