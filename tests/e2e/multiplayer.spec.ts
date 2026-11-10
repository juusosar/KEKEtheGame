import { expect, type Page } from '@playwright/test';
import config from '../../packages/shared/src/data/config.json' with { type: 'json' };
import {
  createRoom,
  expectSettled,
  game,
  joinRoom,
  players,
  remoteSeen,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M2-7: the M2 "done when" in one spec. One player creates a room, the others join it by its code,
// everyone readies up and the host starts; then each player in turn walks right and every other player
// sees that avatar walk too, smoothly (no jumps or snapping back in the interpolated position).

interface Seat {
  page: Page;
  name: string;
}

/** Puts `count` players (separate browser contexts) into one running round and returns them, host first. */
async function startRound(
  newPlayer: (pageErrors: Error[]) => Promise<Page>,
  names: string[],
  pageErrors: Error[],
): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (const name of names) seats.push({ page: await newPlayer(pageErrors), name });
  const [host, ...guests] = seats;
  if (!host) throw new Error('no players');

  await toPlay(host.page, host.name, '?debug=1');
  const code = await createRoom(host.page);
  for (const guest of guests) {
    await toPlay(guest.page, guest.name, '?debug=1');
    await joinRoom(guest.page, code);
  }
  for (const { page } of seats) await expect(players(page)).toHaveCount(seats.length);

  for (const { page } of seats) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  const start = host.page.getByRole('button', { name: 'Start' });
  await expect(start).toBeEnabled();
  await start.click();
  for (const { page } of seats) {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await expect(page.locator('body')).toHaveAttribute('data-room', code);
  }
  for (const { page } of seats) await waitControlling(page);
  return seats;
}

interface Sample {
  /** ms (performance.now in the page). */
  t: number;
  x: number;
}

/**
 * Samples, once per animation frame for `ms`, where `page` draws the remote player `nickname`.
 * Runs in the page so the samples follow the real render loop rather than Playwright round trips.
 */
function sampleRemoteX(page: Page, nickname: string, ms: number): Promise<Sample[]> {
  return page.evaluate(
    ([name, duration]) =>
      new Promise<Sample[]>((resolve) => {
        type Hook = { remotePlayers(): { nickname: string; x: number }[] };
        // The specs compile without the DOM lib, so reach the page's globals through globalThis.
        const win = globalThis as unknown as {
          __KEKE__?: Hook;
          requestAnimationFrame(cb: () => void): number;
        };
        const hook = win.__KEKE__;
        const xs: { t: number; x: number }[] = [];
        const until = performance.now() + duration;
        const tick = (): void => {
          const remote = hook?.remotePlayers().find((p) => p.nickname === name);
          if (remote) xs.push({ t: performance.now(), x: remote.x });
          if (performance.now() < until) win.requestAnimationFrame(tick);
          else resolve(xs);
        };
        win.requestAnimationFrame(tick);
      }),
    [nickname, ms] as const,
  );
}

/** `mover` walks right; every other seat sees the avatar move right without jumps or backward snaps. */
async function walkAndWatch(mover: Seat, watchers: Seat[]): Promise<void> {
  const before = await Promise.all(watchers.map((w) => remoteSeen(w.page, mover.name)));
  before.forEach((seen, i) => expect(seen, `${watchers[i]?.name} sees ${mover.name}`).not.toBeNull());
  const ownStart = (await game(mover.page)).player.x;

  const samples = Promise.all(watchers.map((w) => sampleRemoteX(w.page, mover.name, 1_200)));
  await mover.page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await mover.page.keyboard.down('KeyD');
  await expect
    .poll(async () => (await game(mover.page)).player.x, { timeout: 5_000 })
    .toBeGreaterThan(ownStart + 40);
  await mover.page.keyboard.up('KeyD');
  const traces = await samples;

  for (const [i, watcher] of watchers.entries()) {
    const start = before[i]?.x ?? 0;
    // The watcher's view catches up with the mover (interpolation runs ~100 ms behind).
    await expect
      .poll(async () => (await remoteSeen(watcher.page, mover.name))?.x ?? 0, {
        timeout: 5_000,
        message: `${watcher.name} sees ${mover.name} move`,
      })
      .toBeGreaterThan(start + 30);
    // Smooth: frame to frame the drawn x never steps back, and never moves faster than twice the
    // walking speed (a snap to a far server position would). Frame rate varies under load, so the
    // limit scales with the time between frames.
    const trace = traces[i] ?? [];
    expect(trace.length, `${watcher.name} drew frames`).toBeGreaterThan(4);
    for (const [k, cur] of trace.entries()) {
      const prev = trace[k - 1];
      if (!prev) continue;
      const dx = cur.x - prev.x;
      expect(dx, `${watcher.name}: ${mover.name} snapped back`).toBeGreaterThan(-0.5);
      expect(dx, `${watcher.name}: ${mover.name} jumped`).toBeLessThan(
        (2 * config.playerSpeed * (cur.t - prev.t)) / 1000 + 4,
      );
    }
  }

  await expectSettled(mover.page);
}

for (const names of [
  ['Hostess', 'Guesto'],
  ['Anna', 'Bert', 'Cilla', 'Dano'],
]) {
  test(`${names.length} players join one room by code and see each other move`, async ({ newPlayer }) => {
    test.setTimeout(90_000);
    const pageErrors: Error[] = [];
    const seats = await startRound(newPlayer, names, pageErrors);

    for (const mover of seats) {
      await walkAndWatch(
        mover,
        seats.filter((s) => s !== mover),
      );
    }

    expect(pageErrors).toEqual([]);
  });
}
