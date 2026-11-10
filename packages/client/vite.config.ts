import { defineConfig } from 'vite';
import { DEV_PROXY_PATH } from './src/net/endpoint.ts';

// Dev only: Vite serves the client on 5173 and forwards everything under DEV_PROXY_PATH
// (Colyseus HTTP matchmaking and the room WebSocket) to the game server.
// In production the server serves client/dist itself, so no proxy is involved.
const serverPort = process.env['PORT'] ?? '2567';
const serverTarget = `http://localhost:${serverPort}`;

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      [DEV_PROXY_PATH]: {
        target: serverTarget,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.slice(DEV_PROXY_PATH.length) || '/',
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Phaser alone is ~1.2 MB minified; one chunk is fine for a LAN game.
    chunkSizeWarningLimit: 2000,
  },
});
