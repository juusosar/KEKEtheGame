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

## Scripts

| Script              | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Server in watch mode + Vite dev server on http://localhost:5173 |
| `npm run build`     | Builds every workspace package that has a `build` script        |
| `npm start`         | Runs the built server on `PORT` (default 2567)                  |
| `npm test`          | Vitest across all packages                                      |
| `npm run test:e2e`  | Playwright end-to-end tests (stub until M0-5)                   |
| `npm run lint`      | ESLint + Prettier check                                         |
| `npm run format`    | Prettier write                                                  |
| `npm run typecheck` | `tsc --noEmit` for the root configs and every package           |

## Development

`npm run dev` starts the game server in watch mode and the Vite dev server together. Open http://localhost:5173: the Boot scene joins the server's `hello` room and shows **connected**. Vite proxies `/colyseus/*` (HTTP matchmaking and the room WebSocket) to the server on `PORT` (default 2567), so the browser only talks to Vite.

`npm run build` writes the client to `packages/client/dist`, which the server serves on its own port in production.

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
```

## Working rules

- TypeScript `strict` everywhere. `any` is a lint error; if you truly need it, disable the rule on that line with a comment explaining why.
- `packages/shared` stays pure and deterministic: no Phaser, Colyseus or DOM; randomness goes through the seeded RNG and time is passed in (`Math.random` and `Date.now` are lint errors there).
- Every tunable number lives in data files. Brand strings live only in `packages/shared/src/theme/*`.
