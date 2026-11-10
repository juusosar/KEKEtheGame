/** Path prefix the Vite dev server proxies to the game server (see vite.config.ts). */
export const DEV_PROXY_PATH = '/colyseus';

export interface PageLocation {
  protocol: string;
  host: string;
}

/**
 * Colyseus endpoint for the page the client was loaded from.
 * Production: the game server serves the client, so it is the page origin.
 * Dev: Vite serves the client and proxies DEV_PROXY_PATH to the server.
 */
export function serverEndpoint(location: PageLocation, dev: boolean): string {
  const origin = `${location.protocol}//${location.host}`;
  return dev ? `${origin}${DEV_PROXY_PATH}` : origin;
}
