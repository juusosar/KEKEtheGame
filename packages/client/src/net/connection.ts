import { HEALTH_PATH, type HealthResponse } from '@keke/shared';

/**
 * Asks the game server's health check (`GET /healthz` on the given endpoint). Resolves with its body,
 * rejects when the server cannot be reached or answers with something else. Replaces the M0 hello room,
 * so the page no longer keeps a second WebSocket open just for the connection badge (M3 review F5).
 */
export async function checkHealth(
  endpoint: string,
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<HealthResponse> {
  const res = await fetcher(`${endpoint}${HEALTH_PATH}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<HealthResponse> | null;
  if (body?.ok !== true) throw new Error('unexpected health check answer');
  return { ok: true, debug: body.debug === true };
}
