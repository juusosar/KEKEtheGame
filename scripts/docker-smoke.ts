// Smoke test for the production Docker image (M7-3): builds the image, runs it, and checks that it
// serves the game page, answers the health check with debug off, refuses a debug message, and lets
// two clients meet in one room by code. Needs a running Docker daemon.
//
//   npm run docker:smoke                      build ./Dockerfile as keke:smoke, then test it
//   npm run docker:smoke -- --no-build        test an existing image (KEKE_IMAGE, default keke:smoke)
//
// Extra `docker build` arguments can go in KEKE_DOCKER_BUILD_ARGS, for example
// "--network host --secret id=npm_ca,src=/path/ca.pem" behind a TLS-intercepting proxy.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import {
  DebugMessage,
  HEALTH_PATH,
  ROOM_NAMES,
  ServerMessage,
  themes,
  type HealthResponse,
  type LobbyErrorMessage,
} from '@keke/shared';

const image = process.env['KEKE_IMAGE'] ?? 'keke:smoke';
const build = !process.argv.includes('--no-build');
const repoRoot = new URL('..', import.meta.url).pathname;

function docker(args: string[], inherit = false): string {
  return execFileSync('docker', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor<T>(
  what: string,
  check: () => T | undefined | Promise<T | undefined>,
  ms = 30_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch {
      // Not ready yet; retry until the deadline.
    }
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

interface SmokeState {
  code: string;
  players: { size: number };
}

async function main(): Promise<void> {
  if (build) {
    const extra = (process.env['KEKE_DOCKER_BUILD_ARGS'] ?? '').split(/\s+/).filter(Boolean);
    console.log(`[smoke] docker build -t ${image} ${extra.join(' ')} .`);
    docker(['build', '-t', image, ...extra, '.'], true);
  }

  const env = JSON.parse(docker(['image', 'inspect', '--format', '{{json .Config.Env}}', image])) as string[];
  check(
    !env.some((e) => e.startsWith('KEKE_DEBUG=') || e.startsWith('KEKE_CONFIG=')),
    'image sets neither KEKE_DEBUG nor KEKE_CONFIG',
  );

  const port = await freePort();
  const container = docker(['run', '-d', '--rm', '-p', `127.0.0.1:${port}:2567`, image]).trim();
  console.log(`[smoke] container ${container.slice(0, 12)} on http://127.0.0.1:${port}`);
  const base = `http://127.0.0.1:${port}`;
  const rooms: Room[] = [];
  try {
    const health = await waitFor('the health check', async () => {
      const res = await fetch(`${base}${HEALTH_PATH}`);
      return res.ok ? ((await res.json()) as HealthResponse) : undefined;
    });
    check(health.ok && health.debug === false, `GET ${HEALTH_PATH} answers {"ok":true,"debug":false}`);
    // Every available map made it into the image and loaded (P1 review F9).
    const expected = Object.values(themes)
      .filter((t) => t.available)
      .map((t) => t.id);
    check(
      expected.every((id) => health.maps.includes(id)),
      `GET ${HEALTH_PATH} lists the loaded maps ${expected.join(', ')} (got ${health.maps.join(', ')})`,
    );

    const page = await fetch(`${base}/`);
    const html = await page.text();
    check(page.ok && html.includes('<script'), 'GET / serves the built client page');
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    check(
      script !== undefined && (await fetch(`${base}${script}`)).ok,
      `the page's script ${script ?? '?'} loads`,
    );

    const host = await new Client(base).create<SmokeState>(ROOM_NAMES.game, { nickname: 'Smoke A' });
    rooms.push(host);
    const code = await waitFor('a room code', () => host.state.code || undefined);
    check(/^[A-Z]{4}$/.test(code), `host created room ${code}`);

    const refusals: LobbyErrorMessage[] = [];
    host.onMessage(ServerMessage.lobbyError, (m: LobbyErrorMessage) => refusals.push(m));
    host.send(DebugMessage.teleport, { x: 0, y: 0 });
    await waitFor('the debug refusal', () => refusals.find((m) => m.code === 'debug_off'));
    check(true, 'debug teleport is refused with debug_off');

    const guest = await new Client(base).join<SmokeState>(ROOM_NAMES.game, { code, nickname: 'Smoke B' });
    rooms.push(guest);
    await waitFor('both players in both views', () =>
      host.state.players.size === 2 && guest.state.players.size === 2 ? true : undefined,
    );
    check(guest.roomId === host.roomId, 'a second client joined the same room by code; both see 2 players');

    const status = await waitFor(
      'the Docker health check',
      () => {
        const s = docker(['inspect', '--format', '{{.State.Health.Status}}', container]).trim();
        return s === 'healthy' ? s : undefined;
      },
      60_000,
    );
    check(status === 'healthy', 'Docker HEALTHCHECK reports healthy');
    console.log('[smoke] PASS');
  } catch (err) {
    console.error('[smoke] FAIL; container log follows');
    try {
      console.error(docker(['logs', container]));
    } catch {
      // The container may already be gone.
    }
    throw err;
  } finally {
    await Promise.allSettled(rooms.map((r) => r.leave()));
    try {
      docker(['stop', container]);
    } catch {
      // Already stopped.
    }
  }
}

await main();
