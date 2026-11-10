import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** Every non-internal IPv4 address of this machine, in interface order, without duplicates. */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal && !addresses.includes(info.address)) {
        addresses.push(info.address);
      }
    }
  }
  return addresses;
}

/** Port of the Vite dev server (packages/client/vite.config.ts, strictPort). */
export const VITE_DEV_PORT = 5173;

/**
 * The lines `npm run dev` prints: the page comes from Vite on 5173, which proxies to this server,
 * so the LAN URLs point at Vite instead of the game server port.
 */
export function devBanner(serverPort: number, interfaces?: Interfaces): string[] {
  return [
    `Dev mode: the game server is on port ${serverPort}, but open the page from Vite on port ${VITE_DEV_PORT}.`,
    ...lanBanner(VITE_DEV_PORT, interfaces),
  ];
}

/** The lines the server prints at startup so players on the LAN know which URL to open (§16). */
export function lanBanner(port: number, interfaces?: Interfaces): string[] {
  const addresses = lanAddresses(interfaces);
  if (addresses.length === 0) {
    return [`Open http://localhost:${port} (no LAN network interface found)`];
  }
  return addresses.map((address) => `Open http://${address}:${port} on any device on this network`);
}
