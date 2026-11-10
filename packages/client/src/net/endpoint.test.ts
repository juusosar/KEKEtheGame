import { describe, expect, it } from 'vitest';
import { DEV_PROXY_PATH, serverEndpoint } from './endpoint';

describe('serverEndpoint', () => {
  it('uses the page origin in production', () => {
    expect(serverEndpoint({ protocol: 'http:', host: '192.168.1.20:2567' }, false)).toBe(
      'http://192.168.1.20:2567',
    );
  });

  it('goes through the Vite proxy path in dev', () => {
    expect(serverEndpoint({ protocol: 'http:', host: 'localhost:5173' }, true)).toBe(
      `http://localhost:5173${DEV_PROXY_PATH}`,
    );
  });

  it('keeps https so the SDK upgrades to wss', () => {
    expect(serverEndpoint({ protocol: 'https:', host: 'keke.example' }, false)).toBe('https://keke.example');
  });
});
