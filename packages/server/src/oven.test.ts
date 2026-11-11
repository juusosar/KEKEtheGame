// The bakery oven through a real room on the second store's map (P2-2): standing on the hot floor burns, the hit broadcast names
// the oven as a hazard, a burn KO drops the carried item like any KO, and nobody gets Wanted for it.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  CombatEventMessage,
  ItemEventMessage,
  getTheme,
  loadConfig,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';
import type { CombatSystem } from './systems/combat/CombatSystem';
import type { ItemSystem } from './systems/items';

// Own port (project memory: P2-2 has 2608).
const PORT = 2608;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});

type Conn = ClientRoom<GameRoom, GameState>;

describe('GameRoom bakery oven (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];
  const registry = loadMapRegistry([getTheme('kespro'), getTheme('prisma')]);
  const oven = registry.get('prisma').map.zones.find((z) => z.id === 'oven');
  if (!oven) throw new Error('prisma map has no oven');
  const OVEN = { x: (oven.bounds.minX + oven.bounds.maxX) / 2, y: (oven.bounds.minY + oven.bounds.maxY) / 2 };

  beforeAll(async () => {
    const server = createGameServer({ config, maps: registry, npcs: false });
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function prismaRound() {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    host.reconnection.enabled = false;
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    for (const type of [...Object.values(CombatEventMessage), ...Object.values(ItemEventMessage)]) {
      host.onMessage(type, (payload: Record<string, unknown>) => events.push({ type, payload }));
    }
    host.send(ClientMessage.settings, { maps: 'prisma' });
    await waitFor(() => room.state.settings.maps === 'prisma');
    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => room.state.players.get(host.sessionId)?.ready === true);
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    expect(room.state.mapId).toBe('prisma');
    const me = room.state.players.get(host.sessionId);
    if (!me) throw new Error('no player');
    return { host, room, me, events };
  }

  it('burns a player standing on the hot floor, as the oven, without Wanted', async () => {
    const { room, me, events } = await prismaRound();
    me.x = OVEN.x;
    me.y = OVEN.y;
    await waitFor(() => me.hp <= config.maxHp - 8);
    await waitFor(() => events.some((e) => e.type === CombatEventMessage.hit));
    const hit = events.find((e) => e.type === CombatEventMessage.hit);
    expect(hit?.payload).toMatchObject({
      source: { kind: 'hazard', id: 'oven' },
      target: me.sessionId,
      damage: 4,
    });
    expect(me.wanted).toBe(false);
    expect(room.state.mapId).toBe('prisma');
  });

  it('a burn KO drops the carried item where the player fell', async () => {
    const { room, me, events } = await prismaRound();
    const internals = room as unknown as { combat: CombatSystem; items: ItemSystem };
    // Carry our own target item (E picks it up within a tile), then stand in the oven nearly KO'd.
    const targetId = me.target;
    const target = room.state.items.get(String(targetId));
    if (!target) throw new Error('no target item');
    me.x = target.x;
    me.y = target.y;
    internals.items.afterFrame(me, Button.Interact, 0, true);
    expect(me.carrying).toBe(targetId);
    const carried = targetId;
    internals.combat.externalHit({
      source: { kind: 'npc', id: 'stocker_1' },
      target: me.sessionId,
      damage: config.maxHp - 2,
      delivery: 'melee',
    });
    me.x = OVEN.x;
    me.y = OVEN.y;
    await waitFor(() => !me.alive);
    // The broadcasts reach the client a moment after the state changed.
    await waitFor(() =>
      [CombatEventMessage.ko, ItemEventMessage.drop].every((t) => events.some((e) => e.type === t)),
    );
    const ko = events.find((e) => e.type === CombatEventMessage.ko);
    expect(ko?.payload).toMatchObject({ player: me.sessionId, source: { kind: 'hazard', id: 'oven' } });
    const drop = events.find((e) => e.type === ItemEventMessage.drop);
    expect(drop?.payload).toMatchObject({ player: me.sessionId, reason: 'ko' });
    expect(me.carrying).toBe(0);
    expect(room.state.items.get(String(carried))?.state).toBe('loose');
    expect(me.wanted).toBe(false);
  });
});
