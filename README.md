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

| Script                | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `npm run dev`         | Server in watch mode + Vite dev server on http://localhost:5173  |
| `npm run build`       | Builds every workspace package that has a `build` script         |
| `npm start`           | Runs the built server on `PORT` (default 2567)                   |
| `npm test`            | Vitest across all packages                                       |
| `npm run test:e2e`    | Playwright end-to-end tests against the production build         |
| `npm run e2e:install` | Downloads Playwright's Chromium (once, before the first e2e run) |
| `npm run lint`        | ESLint + Prettier check                                          |
| `npm run format`      | Prettier write                                                   |
| `npm run typecheck`   | `tsc --noEmit` for the root configs and every package            |

## Development

`npm run dev` starts the game server in watch mode and the Vite dev server together. Open http://localhost:5173: the Boot scene joins the server's `hello` room and shows **connected**. Vite proxies `/colyseus/*` (HTTP matchmaking and the room WebSocket) to the server on `PORT` (default 2567), so the browser only talks to Vite. In dev the server's startup banner prints the Vite URLs (port 5173), since that is where the page lives.

`npm run build` writes the client to `packages/client/dist`, which the server serves on its own port in production.

## End-to-end tests

Run `npm run e2e:install` once to download Playwright's Chromium. After that, `npm run test:e2e` builds everything, starts the built server on port 2568 (`E2E_PORT` to change it) and runs the specs in `tests/e2e/`. Locally it reuses a server that is already listening on that port; with `CI` set it always starts a fresh one. Specs wait on `<body data-connection="connected">` instead of reading the canvas. On Linux, a fresh machine may also need the browser's system libraries: `npx playwright install-deps chromium`. Failure traces and the HTML report land in `test-results/` and `playwright-report/` (open it with `npx playwright show-report`).

## Playing on a LAN

On the host machine run `npm install && npm run build && npm start`. The server prints one line per network interface, like `Open http://192.168.1.20:2567 on any device on this network`; open that URL on any device on the same network. Set `PORT` to use another port.

## Layout

```
packages/
  shared/   pure, deterministic TS: rules, data, theme, map parsing, seeded RNG, types
  server/   Colyseus + Express: rooms, schema, simulation systems
  client/   Phaser 3 + Vite: scenes, net, input, render, i18n, public/assets
maps/       Tiled maps (.tmj) and tilesets
tools/      generators (placeholder art, SFX, item tables)
tests/e2e/  Playwright specs
tests/guards/ repo-wide Vitest checks (brand guard)
```

## Working rules

- TypeScript `strict` everywhere. `any` is a lint error; if you truly need it, disable the rule on that line with a comment explaining why.
- `packages/shared` stays pure and deterministic: no Phaser, Colyseus or DOM; randomness goes through the seeded RNG and time is passed in (`Math.random` and `Date.now` are lint errors there).
- Every tunable number lives in data files.
- Brand strings (store names, colours, tileset and music refs) live only in `packages/shared/src/theme/*`, one file per map. Code reads them through `getTheme()`. `npm test` runs a brand guard (`tests/guards/brand-guard.test.ts`) that fails when a guarded term from any theme's `brand.guardedTerms` appears in a code, data, markup or map file anywhere else, comments included. Lower-case ids such as `kespro` in file names and asset keys are fine. Docs (`*.md`) are not scanned.
- UI text lives in `packages/client/src/i18n/en.json`; use `t('key', { param })` from `packages/client/src/i18n`. Pass brand names in as params from the theme.
