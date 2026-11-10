import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { devBanner, lanAddresses, lanBanner } from './lan';

function iface(address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo {
  const base = { address, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', internal, cidr: null };
  return family === 'IPv4' ? { ...base, family } : { ...base, family, scopeid: 0 };
}

describe('lanAddresses', () => {
  it('keeps only non-internal IPv4 addresses, deduplicated', () => {
    const interfaces = {
      lo: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
      eth0: [iface('192.168.1.20', 'IPv4'), iface('fe80::1', 'IPv6')],
      wlan0: [iface('10.0.0.5', 'IPv4'), iface('192.168.1.20', 'IPv4')],
      down: undefined,
    };
    expect(lanAddresses(interfaces)).toEqual(['192.168.1.20', '10.0.0.5']);
  });
});

describe('lanBanner', () => {
  it('prints one line per LAN address in the §16 format', () => {
    const interfaces = { eth0: [iface('192.168.1.20', 'IPv4')], wlan0: [iface('10.0.0.5', 'IPv4')] };
    expect(lanBanner(2567, interfaces)).toEqual([
      'Open http://192.168.1.20:2567 on any device on this network',
      'Open http://10.0.0.5:2567 on any device on this network',
    ]);
  });

  it('falls back to localhost when there is no LAN interface', () => {
    expect(lanBanner(3000, { lo: [iface('127.0.0.1', 'IPv4', true)] })).toEqual([
      'Open http://localhost:3000 (no LAN network interface found)',
    ]);
  });
});

describe('devBanner', () => {
  it('points LAN players at the Vite port and names the server port', () => {
    const lines = devBanner(2567, { eth0: [iface('192.168.1.20', 'IPv4')] });
    expect(lines[0]).toContain('2567');
    expect(lines[0]).toContain('5173');
    expect(lines.slice(1)).toEqual(['Open http://192.168.1.20:5173 on any device on this network']);
  });
});
