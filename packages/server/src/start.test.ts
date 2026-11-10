import { createServer } from 'node:net';
import { ConfigError, loadConfig } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { startServer } from './start';

/** True when nothing is listening on `port` (we can bind it ourselves). */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

describe('startServer', () => {
  it('refuses to start with a ConfigError when the config is invalid', async () => {
    const port = 2599;
    const bad = { ...loadConfig(), playerSpeed: 'fast' };

    await expect(startServer({ port, rawConfig: bad })).rejects.toThrow(ConfigError);
    await expect(startServer({ port, rawConfig: bad })).rejects.toThrow(/playerSpeed/);
    expect(await portIsFree(port)).toBe(true);
  });

  it('starts with the bundled config and returns it', async () => {
    const { server, config } = await startServer({ port: 0 });
    try {
      expect(config.maxHp).toBeGreaterThan(0);
    } finally {
      await server.gracefullyShutdown(false);
    }
  });
});
