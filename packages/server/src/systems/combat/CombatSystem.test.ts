// CombatSystem and the melee module without a network: a GameState with players placed by hand, frames
// fed through afterFrame, and ticks stepped with an explicit round clock.
import {
  Button,
  defaultThemeId,
  getTheme,
  getWeaponCatalogue,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type CombatEventWire,
  type InputFrame,
  type GameConfig,
  type MapModel,
} from '@keke/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadThemeMap } from '../../maps';
import { GameState, PlayerState } from '../../schema/GameState';
import { CombatSystem } from './CombatSystem';

const config = loadConfig({ ...loadConfig(), roundStartProtectionSeconds: 0 });
const weapons = getWeaponCatalogue();
const TICK = 1 / config.serverTickHz;
let map: MapModel;

beforeAll(() => {
  map = loadThemeMap(getTheme(defaultThemeId));
});

/** An open floor spot: van 0's spawn, then `dx` pixels to the right. */
function spot(dx = 0, dy = 0): { x: number; y: number } {
  const base = vanSpawn(map, 0, playerHalfSize(config));
  return { x: base.x + dx, y: base.y + dy };
}

interface Setup {
  state: GameState;
  combat: CombatSystem;
  events: CombatEventWire[];
  kos: string[];
  players: PlayerState[];
  now: number;
}

function setup(
  count: number,
  {
    teams = false,
    team = (_i: number): number => 0,
    cfg = config,
  }: { teams?: boolean; team?: (i: number) => number; cfg?: GameConfig } = {},
): Setup {
  const state = new GameState();
  state.settings.teams = teams;
  const players: PlayerState[] = [];
  for (let i = 0; i < count; i++) {
    const p = new PlayerState();
    p.sessionId = `p${i}`;
    p.joinOrder = i;
    p.van = 0;
    p.team = team(i);
    const at = spot(i * 30);
    p.x = at.x;
    p.y = at.y;
    state.players.set(p.sessionId, p);
    players.push(p);
  }
  const events: CombatEventWire[] = [];
  const kos: string[] = [];
  const combat = new CombatSystem(
    state,
    cfg,
    map,
    (e) => events.push(e),
    { onKo: (p) => kos.push(p.sessionId) },
    1,
  );
  combat.startRound(players);
  return { state, combat, events, kos, players, now: 0 };
}

function meleeOf(id: string) {
  const def = weapons.require(id);
  if (!('melee' in def)) throw new Error(`${id} has no melee`);
  return def.melee;
}

let seq = 0;
function frame(buttons: number, aim = 0): InputFrame {
  return { seq: ++seq, move: { x: 0, y: 0 }, aim, buttons };
}

/** One server tick in which `attacker` applied one frame with Attack pressed (an edge), aiming at `aim`. */
function swing(s: Setup, attacker: PlayerState, aim = 0): void {
  tick(s, () => s.combat.afterFrame(attacker, frame(Button.Attack, aim), Button.Attack));
}

function tick(s: Setup, frames: () => void = () => undefined): void {
  s.now += TICK;
  s.combat.beginTick(s.now);
  frames();
  s.combat.tick(s.now);
}

function idle(s: Setup, seconds: number): void {
  const until = s.now + seconds;
  while (s.now < until - 1e-9) tick(s);
}

function give(s: Setup, p: PlayerState, weapon: string): void {
  // Roll until the pickup gives the weapon we want (the RNG is seeded, so this is deterministic).
  for (let i = 0; i < 500 && p.weapon !== weapon; i++) s.combat.onPickup(p.sessionId, 'item');
  expect(p.weapon).toBe(weapon);
}

describe('CombatSystem', () => {
  it('starts a round at full HP with fists, mirrored into PlayerState', () => {
    const s = setup(2);
    for (const p of s.players) {
      expect(p.hp).toBe(config.maxHp);
      expect(p.alive).toBe(true);
      expect(p.weapon).toBe('fists');
      expect(p.weaponUses).toBe(-1);
      expect(p.stunned).toBe(false);
      expect(p.slowMultiplier).toBe(1);
    }
  });

  it('rolls a weapon on every pickup and broadcasts weaponRolled; an order box rolls nothing', () => {
    const s = setup(1);
    const [p] = s.players as [PlayerState];
    s.combat.onPickup(p.sessionId, 'item');
    expect(p.weapon).not.toBe('fists');
    expect(p.weaponUses).toBe(weapons.require(p.weapon).uses);
    expect(s.events.at(-1)).toMatchObject({
      type: 'weaponRolled',
      payload: { player: 'p0', previous: 'fists' },
    });
    const held = p.weapon;
    s.combat.onPickup(p.sessionId, 'order_box');
    expect(p.weapon).toBe(held);
  });

  describe('melee', () => {
    it('fists: 5 damage and a small shove away from the attacker, one swing per press', () => {
      const s = setup(2);
      const [a, b] = s.players as [PlayerState, PlayerState];
      const x0 = b.x;
      swing(s, a);
      expect(b.hp).toBe(config.maxHp - 5);
      expect(s.events.map((e) => e.type)).toEqual(['attack', 'hit']);
      idle(s, config.knockbackSeconds + TICK);
      expect(b.x).toBeCloseTo(x0 + meleeOf('fists').knockbackPx, 5);
      // A held button without a new press does nothing.
      tick(s, () => s.combat.afterFrame(a, frame(Button.Attack), 0));
      expect(b.hp).toBe(config.maxHp - 5);
    });

    it('misses when aiming away, and respects the cooldown', () => {
      const s = setup(2);
      const [a, b] = s.players as [PlayerState, PlayerState];
      swing(s, a, Math.PI); // aiming left, b is to the right
      expect(b.hp).toBe(config.maxHp);
      // Fists cooldown 0.4 s: an immediate second press is refused.
      swing(s, a);
      expect(b.hp).toBe(config.maxHp);
      idle(s, 0.4);
      swing(s, a);
      expect(b.hp).toBe(config.maxHp - 5);
    });

    it('baguette: 10 damage, spends a use, hits two bodies in its wide arc', () => {
      const s = setup(3);
      const [a, b, c] = s.players as [PlayerState, PlayerState, PlayerState];
      give(s, a, 'baguette');
      // b ahead, c 60° down-right: inside the 140° arc.
      b.x = a.x + 25;
      b.y = a.y;
      c.x = a.x + 15;
      c.y = a.y + 26;
      swing(s, a);
      expect(b.hp).toBe(config.maxHp - 10);
      expect(c.hp).toBe(config.maxHp - 10);
      expect(a.weaponUses).toBe(19);
    });

    it('frozen salmon: 18 damage and a heavy knockback', () => {
      const s = setup(2);
      const [a, b] = s.players as [PlayerState, PlayerState];
      give(s, a, 'frozen_salmon');
      const x0 = b.x;
      swing(s, a);
      expect(b.hp).toBe(config.maxHp - 18);
      idle(s, 0.5);
      expect(b.x - x0).toBeGreaterThan(48); // 96 px unless a wall is closer
    });

    it('rolling pin: 12 damage and a 0.8 s stun (no movement, no attacks)', () => {
      const s = setup(2);
      const [a, b] = s.players as [PlayerState, PlayerState];
      give(s, a, 'rolling_pin');
      swing(s, a);
      expect(b.hp).toBe(config.maxHp - 12);
      tick(s);
      expect(b.stunned).toBe(true);
      expect(s.combat.speedMultiplier(b)).toBe(0);
      // b cannot swing back while stunned.
      swing(s, b, Math.PI);
      expect(a.hp).toBe(config.maxHp);
      idle(s, 0.8);
      expect(b.stunned).toBe(false);
      expect(s.combat.speedMultiplier(b)).toBe(1);
    });

    it('spent weapon goes back to fists with weaponSpent', () => {
      const s = setup(2);
      const [a, b] = s.players as [PlayerState, PlayerState];
      give(s, a, 'frozen_salmon');
      for (let i = 0; i < 12; i++) {
        b.x = a.x + 25;
        b.y = a.y;
        swing(s, a);
        idle(s, 1);
      }
      expect(a.weapon).toBe('fists');
      expect(s.events.some((e) => e.type === 'weaponSpent')).toBe(true);
    });

    it('no friendly fire with Teams on; team 0 players hit each other', () => {
      const s = setup(3, { teams: true, team: (i) => (i < 2 ? 1 : 2) });
      const [a, mate, foe] = s.players as [PlayerState, PlayerState, PlayerState];
      mate.x = a.x + 20;
      mate.y = a.y;
      foe.x = a.x + 15;
      foe.y = a.y + 10;
      swing(s, a);
      expect(mate.hp).toBe(config.maxHp);
      expect(foe.hp).toBe(config.maxHp - 5);
    });
  });

  describe('KO and respawn', () => {
    it('at 0 HP: KO event, item drop hook, no actions; back at the van after 3 s with protection', () => {
      const s = setup(2);
      const [a, b] = s.players as [PlayerState, PlayerState];
      give(s, b, 'baguette');
      give(s, a, 'frozen_salmon');
      for (let i = 0; i < 6 && b.alive; i++) {
        b.x = a.x + 25;
        b.y = a.y;
        swing(s, a);
        idle(s, 1);
      }
      expect(b.alive).toBe(false);
      expect(b.hp).toBe(0);
      expect(b.weapon).toBe('fists');
      expect(s.kos).toEqual(['p1']);
      expect(s.events.some((e) => e.type === 'ko')).toBe(true);
      expect(s.combat.canAct(b)).toBe(false);
      expect(s.combat.speedMultiplier(b)).toBe(0);
      expect(b.respawnIn).toBeGreaterThan(0);

      idle(s, config.respawnSeconds);
      expect(b.alive).toBe(true);
      expect(b.hp).toBe(config.maxHp);
      expect(b.protected).toBe(true);
      expect({ x: b.x, y: b.y }).toEqual(vanSpawn(map, 0, playerHalfSize(config)));
      expect(s.events.some((e) => e.type === 'respawn')).toBe(true);

      // Spawn protection: hits do not land for 1.5 s.
      a.x = b.x - 20;
      a.y = b.y;
      swing(s, a);
      expect(b.hp).toBe(config.maxHp);
      idle(s, config.spawnProtectionSeconds);
      expect(b.protected).toBe(false);
    });
  });

  it('protects everyone for the first seconds of a round, so neighbouring vans do not open with a brawl (P4-2)', () => {
    const cfg = loadConfig({ ...loadConfig(), roundStartProtectionSeconds: 3 });
    const s = setup(2, { cfg });
    const [a, b] = s.players as [PlayerState, PlayerState];
    expect(a.protected).toBe(true);
    expect(b.protected).toBe(true);
    b.x = a.x + 25;
    b.y = a.y;
    swing(s, a);
    expect(b.hp).toBe(config.maxHp);
    idle(s, 3);
    expect(a.protected).toBe(false);
    expect(b.protected).toBe(false);
    b.x = a.x + 25;
    b.y = a.y;
    swing(s, a);
    idle(s, 0.5);
    expect(b.hp).toBeLessThan(config.maxHp);
  });

  it('resolves attacks after every frame of the tick is recorded (review H3)', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    // a swings from its frame position; b's body is where it ends the tick.
    tick(s, () => {
      s.combat.afterFrame(a, frame(Button.Attack), Button.Attack);
      b.x = a.x + 200; // moved out of reach later in the same tick
    });
    expect(b.hp).toBe(config.maxHp);
  });

  it('reset clears combat fields for the lobby', () => {
    const s = setup(2);
    const [a] = s.players as [PlayerState];
    give(s, a, 'baguette');
    s.combat.reset();
    expect(a.weapon).toBe('fists');
    expect(a.hp).toBe(0);
    expect(s.combat.combatWorld.players).toHaveLength(0);
  });
});
