import { describe, expect, it } from 'vitest';
import { checkHealth } from './connection';

const answer = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('checkHealth', () => {
  it('reads the server health check', async () => {
    let url = '';
    const fetcher = (async (input: string) => {
      url = input;
      return new Response(JSON.stringify({ ok: true, debug: true, maps: ['kespro', 'prisma'] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    await expect(checkHealth('http://host:2567/colyseus', fetcher)).resolves.toEqual({
      ok: true,
      debug: true,
      maps: ['kespro', 'prisma'],
    });
    expect(url).toBe('http://host:2567/colyseus/healthz');
    await expect(checkHealth('', answer(200, { ok: true }))).resolves.toEqual({
      ok: true,
      debug: false,
      maps: [],
    });
  });

  it('rejects an error status, a wrong body and a network failure', async () => {
    await expect(checkHealth('', answer(503, { ok: true }))).rejects.toThrow(/503/);
    await expect(checkHealth('', answer(200, { status: 'up' }))).rejects.toThrow(/unexpected/);
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(checkHealth('', offline)).rejects.toThrow(/Failed to fetch/);
  });
});
