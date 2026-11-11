// Smoke test for the production Docker image (M7-3): builds the image, runs it, and checks that it
// serves the game page, answers the health check with debug off, refuses a debug message, lets
// two clients meet in one room by code, and plays a round on the second store (P4-3): the
// room loads that map, spawns its items, workers and carts, and moves a player from its inputs.
// Needs a running Docker daemon.
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
  ClientMessage,
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

interface SmokePlayer {
  x: number;
  y: number;
  ack: number;
  ready: boolean;
}

interface SmokeState {
  code: string;
  phase: string;
  mapId: string;
  players: { size: number; get(id: string): SmokePlayer | undefined; values(): Iterable<SmokePlayer> };
  items: { size: number };
  npcs: { size: number };
  carts: { size: number };
}

/** The map the round check plays: the second store, so its map, catalogue and twists ship in the image. */
const ROUND_MAP = 'prisma';

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

    // Play a round on the second store (P4-3): one map, one round, both players ready. The round's
    // broadcasts (targets, feed, combat) are not checked here; a catch-all keeps the SDK quiet about them.
    for (const room of rooms) room.onMessage('*', () => undefined);
    host.send(ClientMessage.settings, { maps: ROUND_MAP, roundsPerMap: 1 });
    await waitFor('the map setting', () => (host.state.mapId === ROUND_MAP ? true : undefined));
    for (const room of rooms) room.send(ClientMessage.ready, { ready: true });
    await waitFor('both players ready', () =>
      [...host.state.players.values()].every((p) => p.ready) ? true : undefined,
    );
    host.send(ClientMessage.start);
    await waitFor('the round to start', () => (host.state.phase === 'playing' ? true : undefined), 20_000);
    check(
      host.state.mapId === ROUND_MAP && guest.state.mapId === ROUND_MAP,
      `a round plays on ${ROUND_MAP} (both clients see mapId ${ROUND_MAP})`,
    );
    check(
      host.state.items.size > 0 && host.state.npcs.size > 0 && host.state.carts.size > 0,
      `the ${ROUND_MAP} round has items (${host.state.items.size}), workers (${host.state.npcs.size}) ` +
        `and carts (${host.state.carts.size})`,
    );
    const me = host.state.players.get(host.sessionId);
    if (!me) throw new Error('the host has no player in the state');
    const start = { x: me.x, y: me.y };
    // Walk away from the van for a second, one input frame per 1/30 s as the client does; the first
    // direction that is not blocked is enough.
    let seq = 0;
    let moved = 0;
    for (const move of [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
    ]) {
      for (let i = 0; i < 30; i++) {
        host.send(ClientMessage.input, { seq: ++seq, move, aim: 0, buttons: 0 });
        await new Promise((r) => setTimeout(r, 1000 / 30));
      }
      await waitFor('the server to apply the inputs', () => (me.ack >= seq - 2 ? true : undefined), 5_000);
      moved = Math.hypot(me.x - start.x, me.y - start.y);
      if (moved > 32) break;
    }
    check(
      moved > 32,
      `the host walked ${Math.round(moved)} px on ${ROUND_MAP} from its inputs (ack ${me.ack})`,
    );

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
