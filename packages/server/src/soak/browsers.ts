import { chromium, type Browser, type Page } from '@playwright/test';

// M7-4: real game clients in the soak. Each page is the built client in headless Chromium (?debug=1),
// in its own browser context so it is a separate player. It joins the soak room by code through the
// menus, readies up before each session and, while a round runs, mashes the keys a player would
// (walk WASD, E, Q, Space, mouse clicks), so the page renders 8 players, NPCs, items and effects and
// handles every broadcast. Every console error and uncaught page error is recorded.

export interface BrowserPlayers {
  readonly errors: string[];
  join(code: string, url: string): Promise<void>;
  /** Clicks Ready on every page that is not ready yet. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

const WALK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

export async function startBrowserPlayers(
  count: number,
  log: (line: string) => void,
): Promise<BrowserPlayers> {
  const browser: Browser = await chromium.launch();
  const pages: Page[] = [];
  const errors: string[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  let closed = false;

  const play = (page: Page, index: number): void => {
    let busy = false;
    let held: string | undefined;
    timers.push(
      setInterval(() => {
        if (busy || closed) return;
        busy = true;
        void (async () => {
          const scene = await page.locator('body').getAttribute('data-scene');
          if (scene !== 'game') return;
          // Walk somewhere new now and then, with an action in between.
          if (held) await page.keyboard.up(held);
          held = WALK_KEYS[Math.floor(Math.random() * WALK_KEYS.length)];
          if (held) await page.keyboard.down(held);
          const roll = Math.random();
          if (roll < 0.3) await page.keyboard.press('KeyE');
          else if (roll < 0.35) await page.keyboard.press('KeyQ');
          else if (roll < 0.7) {
            await page.mouse.move(200 + Math.random() * 880, 100 + Math.random() * 520);
            await page.mouse.down();
            await page.mouse.up();
          }
        })()
          .catch((e: unknown) => {
            if (!closed) errors.push(`browser ${index + 1} driver: ${(e as Error).message}`);
          })
          .finally(() => (busy = false));
      }, 400),
    );
  };

  return {
    errors,
    async join(code, url) {
      for (let i = 0; i < count; i++) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const page = await context.newPage();
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(`browser ${i + 1} console.error: ${msg.text()}`);
        });
        page.on('pageerror', (err) => errors.push(`browser ${i + 1} pageerror: ${err.stack ?? err.message}`));
        await page.goto(`${url}/?debug=1&fps=30`);
        await page.waitForSelector('body[data-scene="title"]', { timeout: 30_000 });
        await page.getByRole('button', { name: 'Play' }).click();
        await page.getByLabel('Nickname').fill(`Browser ${i + 1}`);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.waitForSelector('body[data-scene="play"]');
        await page.getByLabel('Room code').fill(code);
        await page.getByRole('button', { name: 'Join', exact: true }).click();
        await page.waitForSelector(`body[data-scene="lobby"][data-room="${code}"]`, { timeout: 15_000 });
        pages.push(page);
        play(page, i);
        log(`soak: browser ${i + 1} joined`);
      }
    },
    async ready() {
      for (const page of pages) {
        await page.waitForSelector('body[data-scene="lobby"]', { timeout: 30_000 });
        const button = page.getByRole('button', { name: 'Ready', exact: true });
        if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
      }
    },
    async close() {
      closed = true;
      for (const t of timers) clearInterval(t);
      await browser.close();
    },
  };
}
