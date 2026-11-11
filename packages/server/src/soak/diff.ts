// M7-4: compares the server's room state with a client's decoded copy (both as `toJSON()` output).
// float32 schema fields reach the client rounded to float32, so numbers match with a small relative
// tolerance; everything else must be equal, including which keys the maps hold.

const FLOAT32_TOLERANCE = 1e-5;

function close(a: number, b: number): boolean {
  if (Object.is(a, b)) return true;
  return Math.abs(a - b) <= FLOAT32_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

/** The paths where `client` differs from `server`, e.g. `players.abc.x: server 12.5, client 13`. */
export function diffStates(server: unknown, client: unknown, path = '', out: string[] = []): string[] {
  if (typeof server === 'number' && typeof client === 'number') {
    if (!close(server, client)) out.push(`${path}: server ${server}, client ${client}`);
    return out;
  }
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (isObject(server) && isObject(client)) {
    const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
    for (const key of keys) {
      const sub = path ? `${path}.${key}` : key;
      if (!(key in client)) out.push(`${sub}: missing on the client`);
      else if (!(key in server)) out.push(`${sub}: only on the client`);
      else diffStates(server[key], client[key], sub, out);
    }
    return out;
  }
  if (server !== client)
    out.push(`${path}: server ${JSON.stringify(server)}, client ${JSON.stringify(client)}`);
  return out;
}
