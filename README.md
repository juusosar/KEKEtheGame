# KEKE the Game

A chaotic multiplayer browser game: grab your assigned item in a wholesale store, haul it back to your van, and fight everyone on the way.

## Requirements

- Node.js 20.19 or newer (see `.nvmrc`), npm 10 or newer.

## Getting started

```sh
npm install
npm run typecheck
npm run lint
npm test
```

### Windows: line endings

The repo forces LF line endings through `.gitattributes`, because Prettier (and so `npm run lint`) expects LF. A fresh clone gets this automatically. A clone made before `.gitattributes` existed may still have CRLF files; fix it once with:

```sh
git rm --cached -r . && git reset --hard
```

## Scripts

| Script                 | What it does                                                            |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run dev`          | Server in watch mode + Vite dev server on http://localhost:5173         |
| `npm run build`        | Builds every workspace package that has a `build` script                |
| `npm start`            | Runs the built server on `PORT` (default 2567)                          |
| `npm test`             | Vitest across all packages                                              |
| `npm run test:e2e`     | Playwright end-to-end tests against the production build                |
| `npm run e2e:install`  | Downloads Playwright's Chromium (once, before the first e2e run)        |
| `npm run lint`         | ESLint + Prettier check                                                 |
| `npm run format`       | Prettier write                                                          |
| `npm run typecheck`    | `tsc --noEmit` for the root configs and every package                   |
| `npm run gen:art`      | Regenerates the placeholder art (see below)                             |
| `npm run gen:map`      | Regenerates `maps/kespro.tmj` from `tools/map/kespro.ts`                |
| `npm run gen:items`    | Regenerates the item catalogue JSON from `tools/items/*.md`             |
| `npm run gen:sfx`      | Regenerates the placeholder sound effects and music (see below)         |
| `npm run docker:smoke` | Builds the Docker image and checks that it runs the game (needs Docker) |
| `npm run soak`         | 8-player multi-session soak test (see below)                            |

## Development

`npm run dev` starts the game server in watch mode and the Vite dev server together. Open http://localhost:5173: the Boot scene reads the server's health check (`GET /healthz`, answering `{ ok, debug }`) and shows **connected**. Vite proxies `/colyseus/*` (HTTP matchmaking and the room WebSocket) to the server on `PORT` (default 2567), so the browser only talks to Vite. In dev the server's startup banner prints the Vite URLs (port 5173), since that is where the page lives.

`npm run build` writes the client to `packages/client/dist`, which the server serves on its own port in production.

## End-to-end tests

Run `npm run e2e:install` once to download Playwright's Chromium. After that, `npm run test:e2e` builds everything, starts the built server on port 2568 (`E2E_PORT` to change it) and runs the specs in `tests/e2e/`. Locally it reuses a server that is already listening on that port; with `CI` set it always starts a fresh one. Specs wait on `<body data-connection="connected">` and `<body data-scene="game">`, and read game state through the `?debug=1` hook `window.__KEKE__`, instead of reading the canvas. On Linux, a fresh machine may also need the browser's system libraries: `npx playwright install-deps chromium`. Failure traces and the HTML report land in `test-results/` and `playwright-report/` (open it with `npx playwright show-report`).

## Soak test

`npm run soak` plays whole sessions with 8 simulated players against an in-process server: a 3-round Timed, a 3-round Race, then both again with teams on, back to back in the same room (about 13 minutes with the soak's shorter rounds and a race quota of 2). The bots (`packages/server/src/soak/bot.ts`) play from their own decoded copy of the state like real clients: they walk with the shared pathfinder, fetch their target, deposit it, carry race boxes to the office, steal, fight each other and hit store workers (so they get Wanted). The soak fails on any server or client error, any desync (it pauses the simulation now and then and compares every client's state with the server's), a podium or lobby that is not clean, bots that never picked up, deposited, knocked someone out, got Wanted, packed a box or delivered one, and growth of tick time or heap between the first and the last session. It prints a summary and writes `test-results/soak/report.json`.

Options: `--players 8`, `--sessions timed,race,timed+teams,race+teams`, `--rounds 3`, `--timed 45 --race 75` (round seconds; `--timed 180 --race 240` for the real lengths), `--port 2597`, `--seed 7`. `--browsers 2` makes two of the players real game clients in headless Chromium that join through the menus and mash keys, and fails on their console errors (run `npm run build` first). `npm test` runs a short version (2 Race rounds with teams).

## Placeholder art

v1 art is generated by `tools/gen-placeholder-art.ts` (`npm run gen:art`): simple shapes and letters packed into Phaser JSON-hash atlases that match the sprite spec exactly, so real art can replace the files later without code changes. It writes to `packages/client/public/assets/`:

- one atlas (`<sheet>.png` + `<sheet>.json`) per sheet: `body` (greyscale, tinted at runtime), `hat_<id>`, `stocker`, `security`, `butcher`, `customer`, `weapons`, `items`, `order_box`, `forklift`, `van`, `fx`;
- `kespro_tiles.png`, the map tileset, plus a Tiled tileset `maps/kespro_tiles.tsj` whose tiles carry `name`, `solid` and `above` properties;
- `manifest.json`, listing every atlas, every animation (`<sheet>/<anim>_<dir>`, e.g. `body/walk_down`, with its frames and frame rate) and the tilesets.

Character frames are named `<anim>_<dir>_<i>`. The output is deterministic and committed; a test fails if the committed files differ from what the generator produces, so rerun `npm run gen:art` after changing it.

## Placeholder audio

v1 sound is generated by `tools/gen-sfx.ts` (`npm run gen:sfx`), a small jsfxr-style synthesiser in `tools/sfx/`: each sound effect is a few oscillator layers (square, saw, triangle, sine or pitched noise) with a pitch slide or step sequence and an envelope (`tools/sfx/sounds.ts`), and each map's music loop is a short chiptune score rendered with the same synth (`tools/sfx/music.ts`). It writes 16-bit mono WAV files to `packages/client/public/assets/`:

- `audio/<name>.wav`, one per name in `packages/client/src/audio/names.ts` (the client's list of sound effects);
- the music loop each available theme names in `assets.music`, e.g. `music/kespro_loop.wav`.

Everything is original and made in the repo. The output is deterministic and committed; a test fails if the committed files differ from the generator, so rerun `npm run gen:sfx` after changing it. To add a sound, add its name to `names.ts` and its layers to `sounds.ts`.

## Maps

`maps/kespro.tmj` is a Tiled map (120 × 80 tiles of 32 px) generated by `tools/gen-kespro-map.ts` (`npm run gen:map`) from the layout in `tools/map/kespro.ts`. It has the tile layers `ground`, `walls` (collision), `decor` and `above` (drawn over players), and the object layers `zones`, `van_slots`, `item_spawns`, `npc_spawns`, `npc_waypoints`, `forklift_routes` and `office_trigger`. The tileset is embedded (copied from `maps/kespro_tiles.tsj`, first gid 1) so Phaser can load the map directly. The file opens in Tiled for a look, but edit the generator rather than the map: a test fails if the committed map differs from the generator output, and it also checks the zones, van slots, spawn counts, spawn reachability from the dock and spawn distance from the vans. Rerun `npm run gen:map` after `npm run gen:art` changes the tileset.

## Item catalogue

The items players fetch live in `packages/shared/src/data/items.kespro.json` (fields `id`, `name`, `desc`, `zone`, `sprite`, `rarity`). It is generated from the Markdown tables in `tools/items/items.kespro.md`, which copy the design doc's item tables: edit the tables (or paste the doc's tables over them) and run `npm run gen:items`. The output is checked against the shared zod schema; a test fails if the committed JSON differs from the tables, if an item has no frame in the `items` atlas, or if an item zone has no spawn points on the map. Code reads it with `getItemCatalogue('kespro')` from `@keke/shared`.

## Store workers

The store workers (§8) live in `packages/shared/src/data/npcs.json`: one entry per worker type with its behaviour (`stocker`, `security`, `forklift`, `butcher`), HP, attack, speeds, how many spawn per player count, and where (waypoints, posts, forklift loops and zones come from the map, checked by `checkNpcMap` at server start). The numbers given in §8 are the design's; the rest (speeds, ranges, cooldowns, timings) are starting values to tune in playtests. A new worker that behaves like an existing one is JSON only. A new behaviour is one file in `packages/server/src/systems/npcs/` exporting a behaviour module plus one line in `defaultNpcBehaviours()` in `modules.ts`; the client draws every worker from its synced behaviour and mode, so it needs no code for a new type. Workers run on the server only in the playing phase.

Wanted (§8, §17) is set from `packages/shared/src/data/config.json`: `wantedSeconds` (how long Wanted lasts after the last offence, 20), `wantedGuardRangeTiles` (how far a guard sees a fight, with a clear line, 6) and `npcRespawnSeconds` (how long a knocked-out worker stays down, 30). Hitting a worker, being seen hitting a player by a guard, or entering a staff-only zone makes a player Wanted; guards chase Wanted players.

## Game modes and Teams

The host picks the mode and Teams in the lobby; both stay fixed from **Start** until the session is back in the lobby. Round timers, the quota and the scoring numbers live in `packages/shared/src/data/config.json`.

- **Timed** (`timedRoundSeconds`, 180 s): fetch your highlighted target, carry it to your van and it banks automatically within `depositRangeTiles` of the van. Rank by item points deposited; a joke item is worth `jokeItemValue`.
- **Quota + Race** (`raceRoundSeconds`, 240 s cap): when your van's banked points reach `raceQuota` (6; with Teams on a team van needs `raceTeamQuotaPerMember` (3) per member when that is more, so 12 for a team of 4), the items are packed into an order box that the depositor carries (slower, no other items). Run it to the office (the `office_trigger` object on the map, an arrow on the HUD and a marker on everyone's minimap); the first delivery ends the round and that side is 1st. Anyone can grab a dropped box (Q, a KO, a banana slip, a forklift) and deliver it as their own; a stolen box counts for nobody until delivered. If two carriers reach the office in the same tick, the room's seeded RNG picks one. At the cap, everyone is ranked by items they control (banked points plus their side's own box). The results screen shows that number as **Controlled**, and the deliverer gets a **Delivered** tag.
- **Teams**: two teams, red and blue, auto-balanced when Teams is switched on, when players join or leave, and at every countdown (a moved player gets a feed line). Each team shares one van, one quota and one box; targets stay personal and there is no friendly fire. Team places use the team van's total (Timed) or the items it controls (Race). Wanted stays per player.

Session standings (§5): placement points per round, ties broken by item points deposited. Code: the pure rules in `packages/shared/src/rules/modes/` (`timed.ts`, `race.ts`) and the server flow in `packages/server/src/rooms/GameRoom.ts`.

Testing aids (only with `KEKE_DEBUG=1`, never on a real server): `__KEKE__.vanPoints(n)` sets our van's banked points (`raceQuota - 1` plus one deposit packs a box) and `__KEKE__.giveWeapon(id)` hands us a weapon. `__KEKE__.noNpcs()` (host) removes the store workers from the room for good; specs that are not about NPCs call it through `noNpcs(host)` in tests/e2e/helpers.ts. `__KEKE__.holdNpc(id, seconds)` keeps one store worker standing still (at most 30 s, or until it is hit), so a spec can walk up and punch it. `KEKE_CONFIG=<file.json>` overrides config keys on the server (the e2e server uses `tests/e2e/config.e2e.json` for short timers). The client bundles its own copy of the config for prediction, so do not override keys it also reads (movement speeds, tick rate); the race quota is synced from the room, so overriding it is fine.

## Walking the map (M1)

Boot starts the Title menu. To walk the map offline without a room, open the game with `?scene=game` (http://localhost:5173/?scene=game in dev, add `&debug=1` for the overlay): one local player on the map, starting at van slot 1 on the loading dock. Move with WASD or a gamepad's left stick. Movement runs through the shared rules in `packages/shared/src/rules/movement.ts`, the same code the server will run, so walls and the slippery cold room behave the same everywhere. The camera follows at 2× zoom. Client-only render values (zoom, follow smoothing, the player's default colour and hat) are in `packages/client/src/game/render-config.json`.

Add `?debug=1` to the URL (http://localhost:5173/?debug=1 in dev, or `?scene=game&debug=1`) for the debug overlay: walls in red, each zone filled and labelled with its id, van slots and the office trigger outlined, the player's hitbox in green, and a readout of position, zone, input device and fps in the top-right corner. Debug mode also installs `window.__KEKE__` (types in `packages/client/src/game/hookTypes.ts`), which the e2e specs use to read the player's position and zone and to teleport. In a round, `__KEKE__.items()` and `__KEKE__.vans()` list the items and vans as drawn (outline colour, atlas frame, carrier), and `net()` adds our `van`, `carrying`, `target` and `deposited`, plus combat state (`hp`, `alive`, `weapon`, `weaponUses`, `stunned`, `protected`, `respawnIn`; also on each `remotePlayers()` entry). `combatEvents()` lists the last 50 combat broadcasts (`attack`, `hit`, `ko`, `respawn`, `weaponRolled`, `weaponSpent`). In a room `teleport(x, y)` and `endPhase()` (host only) ask the server to move us or to end the current phase now; a server only honours them when started with `KEKE_DEBUG=1` (the e2e server is, see `playwright.config.ts`, so `tests/e2e/round.spec.ts` can script a pickup and a deposit and skip the 180 s clock). Never set `KEKE_DEBUG` on a real server.

## Playing on a LAN

On the host machine run `npm install && npm run build && npm start`. The server prints one line per network interface, like `Open http://192.168.1.20:2567 on any device on this network`; open that URL on any device on the same network. Set `PORT` to use another port.

The server runs as a single process: game rooms, matchmaking and the game page all share one port (TCP 2567 by default), so that is the only port the firewall has to let in. Anyone on the network can open the page and join rooms; there are no accounts or passwords, so only run it on networks you trust.

To run the same build without installing Node.js, use the Docker image (see [Docker image](#docker-image)) and publish the port on every interface: `docker run --rm -p 2567:2567 keke`. Inside a container the startup banner lists the container's own addresses (`172.17.x.x`), which other machines cannot reach; open `http://<host-lan-ip>:2567` instead (`ipconfig` on Windows, `ip addr` on Linux, System Settings > Network on macOS).

### LAN check (M2)

The M2 goal is that 4 browser tabs, and 2 machines on one LAN, join one room by code and see each other move smoothly. `tests/e2e/multiplayer.spec.ts` covers the tabs automatically (2 and 4 players in separate browser contexts); the machines need a person:

1. On machine A, run `npm install && npm run build && npm start` and note the `Open http://<lan-ip>:2567 …` line. On Windows, allow Node.js through the firewall on private networks when asked (or allow inbound TCP 2567).
2. On machine A, open `http://localhost:2567/?debug=1`, press **Play**, pick a nickname, then **Create room**. The lobby shows a 4-letter room code.
3. On machine B, open the `http://<lan-ip>:2567/?debug=1` URL from step 1. If it does not load, check that both machines are on the same network and that the firewall lets port 2567 in.
4. On machine B, press **Play**, pick another nickname, type the code under **Room code** and press **Join**. Both lobbies now list both players.
5. Press **Ready** on both, then **Start** on machine A. After the 3 s countdown, walk with WASD (or a gamepad) on one machine and watch the other: the avatar with that nickname moves with it, without jumps or rubber-banding. Swap roles and repeat.
6. For four players, open two more tabs (or devices) the same way, give each its own nickname and join the same code. Open each tab fresh rather than duplicating one: a duplicated tab copies the reload token and resumes the original tab's player.

With `?debug=1` the overlay's readout and `window.__KEKE__.net()` in the browser console show the netcode state; `lastCorrection` near 0 means the server agrees with the local prediction.

## Docker image

The `Dockerfile` builds one production image in two stages: the first installs everything and runs `npm run build` (client to `packages/client/dist`, server bundle to `packages/server/dist`, maps copied to `packages/server/dist/maps`); the second holds only the server's production dependencies and those two build outputs, and runs as the unprivileged `node` user.

```sh
docker build -t keke .
docker run -d --name keke --restart unless-stopped -p 2567:2567 keke
```

- `PORT` inside the container is 2567; change the published side instead (`-p 8080:2567`).
- The image never sets `KEKE_DEBUG` or `KEKE_CONFIG`, so debug room messages are off: `curl http://localhost:2567/healthz` answers `{"ok":true,"debug":false}`. Do not pass `-e KEKE_DEBUG=1` to a server other people can reach.
- Docker's own health check polls `/healthz`; `docker ps` shows `healthy` once the server is up.
- Game state lives in memory only. Restarting the container ends every running room; there is nothing to back up.
- Behind a proxy that intercepts TLS, give `npm ci` its CA certificate with `docker build --secret id=npm_ca,src=/path/to/ca.pem -t keke .`. The secret is only mounted while npm runs and is not stored in the image.

`npm run docker:smoke` builds the image as `keke:smoke`, starts it on a free local port and checks that the page and its script load, `/healthz` reports debug off, a debug message is refused, two clients meet in one room by its code, and the Docker health check turns healthy. Add `-- --no-build` to test an image you already built (`KEKE_IMAGE` names it), and put extra `docker build` flags in `KEKE_DOCKER_BUILD_ARGS`. Run it after changing the Dockerfile, the build scripts or anything the server loads from disk at startup.

## Hosting online (VPS)

For games over the internet, run the image on any small Linux VPS (1 vCPU and 1 GB of RAM should do for a few rooms of 8; not load-tested yet) with Docker and [Caddy](https://caddyserver.com/docs/install) installed, and a domain name whose DNS record points at the server.

1. Copy the repo to the server (`git clone`) and build the image: `docker build -t keke .`
2. Start it with the port published on localhost only, so the game is reached through Caddy and HTTPS: `docker run -d --name keke --restart unless-stopped -p 127.0.0.1:2567:2567 keke`
3. Check it: `curl http://127.0.0.1:2567/healthz` answers `{"ok":true,"debug":false}`.
4. Copy `Caddyfile.example` to `/etc/caddy/Caddyfile`, put your domain in place of `game.example.com`, and run `sudo systemctl reload caddy`. Caddy fetches the HTTPS certificate itself and passes the WebSocket connections through.
5. Open ports 80 and 443 in the VPS firewall (for example `sudo ufw allow 80,443/tcp`), and keep 2567 closed.
6. Open `https://<your-domain>` and share the room code with your friends.

To update: `git pull`, `docker build -t keke .`, then `docker rm -f keke` and the `docker run` line from step 2 again. This ends the rooms in progress, so do it between games. Run one container only: rooms live in that process's memory, so a second instance behind a load balancer would split players across servers that cannot see each other's rooms.

## Layout

```
packages/
  shared/   pure, deterministic TS: rules, data, theme, map parsing, seeded RNG, types
  server/   Colyseus + Express: rooms, schema, simulation systems
  client/   Phaser 3 + Vite: scenes, net, input, render, i18n, public/assets
maps/       Tiled maps (.tmj) and tilesets
tools/      generators (placeholder art, SFX, item tables)
scripts/    repo scripts (docker:smoke)
tests/e2e/  Playwright specs
tests/guards/ repo-wide Vitest checks (brand guard)
```

## Working rules

- TypeScript `strict` everywhere. `any` is a lint error; if you truly need it, disable the rule on that line with a comment explaining why.
- `packages/shared` stays pure and deterministic: no Phaser, Colyseus or DOM; randomness goes through the seeded RNG and time is passed in (`Math.random` and `Date.now` are lint errors there).
- Every tunable number lives in data files.
- Brand strings (store names, colours, tileset and music refs) live only in `packages/shared/src/theme/*`, one file per map. Code reads them through `getTheme()`. `npm test` runs a brand guard (`tests/guards/brand-guard.test.ts`) that fails when a guarded term from any theme's `brand.guardedTerms` appears in a code, data, markup or map file anywhere else, comments included. Lower-case ids such as `kespro` in file names and asset keys are fine. Docs (`*.md`) are not scanned.
- UI text lives in `packages/client/src/i18n/en.json`; use `t('key', { param })` from `packages/client/src/i18n`. Pass brand names in as params from the theme.
