import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, resolvePort } from './app';
import type { HelloMessage } from './rooms/HelloRoom';

describe('hello room (integration)', () => {
  let colyseus: ColyseusTestServer;
  let clientDist: string;

  beforeAll(async () => {
    clientDist = mkdtempSync(join(tmpdir(), 'keke-client-dist-'));
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>KEKE test page</title>');
    colyseus = await boot(createGameServer({ clientDist }));
  });

  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(clientDist, { recursive: true, force: true });
  });

  it('lets a client join the hello room and greets it', async () => {
    const room = await colyseus.createRoom('hello');
    const client = await colyseus.connectTo(room);
    const hello = await new Promise<HelloMessage>((resolve) => client.onMessage('hello', resolve));

    expect(room.clients.length).toBe(1);
    expect(hello).toEqual({ message: 'connected', roomId: room.roomId, sessionId: client.sessionId });
    await client.leave();
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
