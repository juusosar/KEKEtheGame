import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, resolvePort } from './app';
import type { HealthResponse } from '@keke/shared';

// Ports: boot() defaults to 2568; the debug server needs its own (2591; 2571, 2572 and 2574 to 2580 are taken).
describe('game server HTTP (integration)', () => {
  let colyseus: ColyseusTestServer;
  let debugServer: ColyseusTestServer;
  let clientDist: string;

  beforeAll(async () => {
    clientDist = mkdtempSync(join(tmpdir(), 'keke-client-dist-'));
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>KEKE test page</title>');
    colyseus = await boot(createGameServer({ clientDist }));
    // boot() ignores its port argument for a Server instance, so listen here instead.
    const withDebug = createGameServer({ clientDist, debug: true });
    await withDebug.listen(2591);
    debugServer = new ColyseusTestServer(withDebug);
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await debugServer.shutdown();
    rmSync(clientDist, { recursive: true, force: true });
  });

  it('answers /healthz with ok and whether the debug messages are on', async () => {
    const res = await colyseus.http.get('/healthz');
    expect(res.data as HealthResponse).toEqual({ ok: true, debug: false, maps: ['kespro', 'prisma'] });
    const debug = await debugServer.http.get('/healthz');
    expect((debug.data as HealthResponse).debug).toBe(true);
  });

  it('no longer defines the M0 hello room', async () => {
    await expect(colyseus.createRoom('hello')).rejects.toThrow();
  });

  it('serves the built client on the same port', async () => {
    const res = await colyseus.http.get('/');
    expect(String(res.data)).toContain('KEKE test page');
  });
});

describe('resolvePort', () => {
  it('defaults to 2567 and accepts a valid PORT', () => {
    expect(resolvePort(undefined)).toBe(2567);
    expect(resolvePort('')).toBe(2567);
    expect(resolvePort('8080')).toBe(8080);
  });

  it('rejects an invalid PORT with a clear error', () => {
    expect(() => resolvePort('abc')).toThrow(/PORT must be an integer/);
    expect(() => resolvePort('70000')).toThrow(/PORT must be an integer/);
  });
});
