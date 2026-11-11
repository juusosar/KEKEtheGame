// CartSystem against customers (P2-3 x P2-5): solid store workers stop carts, and a rolling cart that
// crashes into one calls `bump` (the room turns that into customer panic) without hurting anyone.
import { getTheme, loadConfig, playerHalfSize, type Circle, type Vec2 } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { loadMapRegistry } from '../maps';
import { GameState } from '../schema/GameState';
import { CartSystem } from './carts';

const config = loadConfig();
const map = loadMapRegistry([getTheme('prisma')]).get('prisma').map;
const CART = config.cartSizePx / 2;
const half = playerHalfSize(config);

function setup(customer: Circle): { carts: CartSystem; bumps: Vec2[] } {
  const bumps: Vec2[] = [];
  const carts = new CartSystem(new GameState(), config, map, {
    solids: () => [customer],
    bump: (at) => bumps.push(at),
  });
  carts.startRound();
  return { carts, bumps };
}

describe('CartSystem and customers', () => {
  it('a shoved cart stops at a customer and bumps them', () => {
    const first = map.cartSpawns[0];
    if (!first) throw new Error('no cart spawn');
    // Out in the lot west of the corral: a customer 3 tiles west of the cart.
    const cartAt = { x: first.x - 6 * config.tileSize, y: first.y };
    const customer = { x: cartAt.x - 3 * config.tileSize, y: cartAt.y, r: 10 };
    const { carts, bumps } = setup(customer);
    const cart = carts.bodies[0];
    if (!cart) throw new Error('no cart');
    cart.x = cartAt.x;
    cart.y = cartAt.y;
    carts.shove({ x: cart.x + 40, y: cart.y }, { x: cart.x + 20, y: cart.y }, 14, { x: -1, y: 0 }, new Set());
    for (let i = 0; i < 60; i++) carts.tick(i / config.serverTickHz);
    expect(cart.x).toBeCloseTo(customer.x + customer.r + CART, 6);
    expect(bumps).toEqual([{ x: customer.x, y: customer.y }]);
  });

  it('a pushed cart stops at a customer; the pusher stops behind it', () => {
    const first = map.cartSpawns[0];
    if (!first) throw new Error('no cart spawn');
    const cartAt = { x: first.x - 6 * config.tileSize, y: first.y };
    const customer = { x: cartAt.x - CART - 10 - 4, y: cartAt.y, r: 10 };
    const { carts, bumps } = setup(customer);
    const cart = carts.bodies[0];
    if (!cart) throw new Error('no cart');
    cart.x = cartAt.x;
    cart.y = cartAt.y;
    const player = { sessionId: 'p', x: cart.x + CART + half.hw, y: cart.y } as never;
    let at = { x: cart.x + CART + half.hw, y: cart.y, vx: 0, vy: 0 };
    for (let i = 0; i < 10; i++) {
      const next = { ...at, x: at.x - config.playerSpeed / config.inputHz };
      at = carts.push(player, at, next, i / config.inputHz);
    }
    expect(cart.x).toBeCloseTo(customer.x + customer.r + CART, 6);
    expect(at.x).toBeCloseTo(cart.x + CART + half.hw, 6);
    expect(bumps).toEqual([]);
  });
});
