import { getNpcCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import type { NpcView } from '../net/npcView';
import {
  NPC_KO_ALPHA,
  facingFromAim,
  forkliftBeepDue,
  forkliftBeeping,
  hearingVolume,
  npcLook,
  npcMelee,
  npcTypeFromId,
  type NpcLookInput,
} from './npcLook';

const stocker: NpcView = {
  id: 'stocker_1',
  type: 'stocker',
  behaviour: 'stocker',
  x: 100,
  y: 100,
  aim: 0,
  moving: false,
  hp: 60,
  maxHp: 60,
  alive: true,
  respawnIn: 0,
  stunned: false,
  mode: 'idle',
  target: '',
};
const forklift: NpcView = {
  ...stocker,
  id: 'forklift_1',
  type: 'forklift',
  behaviour: 'forklift',
  hp: 0,
  maxHp: 0,
};
const all = () => true;
const input = (npc: NpcView, extra: Partial<NpcLookInput> = {}): NpcLookInput => ({
  npc,
  sheet: npc.type,
  facing: 'left',
  now: 10,
  attackUntil: 0,
  flashUntil: 0,
  ...extra,
});

describe('facingFromAim', () => {
  it('maps aim angles to the four sheet directions', () => {
    expect(facingFromAim(0, 'down')).toBe('right');
    expect(facingFromAim(Math.PI, 'down')).toBe('left');
    expect(facingFromAim(Math.PI / 2, 'left')).toBe('down');
    expect(facingFromAim(-Math.PI / 2, 'left')).toBe('up');
    expect(facingFromAim(Number.NaN, 'up')).toBe('up');
  });
});

describe('npcLook', () => {
  it('walks, idles, swings, flashes and lies down from the synced state and events', () => {
    expect(npcLook(input(stocker), all).anim).toBe('stocker/idle_left');
    expect(npcLook(input({ ...stocker, moving: true }), all).anim).toBe('stocker/walk_left');
    expect(npcLook(input(stocker, { attackUntil: 10.1 }), all).anim).toBe('stocker/attack_left');
    const hit = npcLook(input(stocker, { flashUntil: 10.1 }), all);
    expect(hit).toMatchObject({ anim: 'stocker/hit_left', flash: true });
    const ko = npcLook(input({ ...stocker, alive: false, hp: 0 }, { flashUntil: 11 }), all);
    expect(ko).toMatchObject({ anim: 'stocker/ko_left', alpha: NPC_KO_ALPHA, flash: false, hpFill: null });
  });

  it('falls back to idle when the sheet lacks a pose', () => {
    const has = (key: string) => key.includes('idle');
    expect(npcLook(input(stocker, { attackUntil: 11 }), has).anim).toBe('stocker/idle_left');
  });

  it('marks workers that are after someone and shows the HP bar while hurt', () => {
    const angry = npcLook(input({ ...stocker, target: 'p1', hp: 30 }), all);
    expect(angry.hostile).toBe(true);
    expect(angry.hpFill).toBeCloseTo(0.5);
    expect(npcLook(input(stocker), all)).toMatchObject({ hostile: false, hpFill: null });
  });

  it('drives forklifts with the light on and no HP bar', () => {
    const look = npcLook(input({ ...forklift, moving: true }, { facing: 'up' }), all);
    expect(look).toMatchObject({ anim: 'forklift/drive_up', light: true, hpFill: null, hostile: false });
    // Parked outside the playing phase: no light (M5 review F3).
    const parked = npcLook(
      { ...input({ ...forklift, moving: true }, { facing: 'up' }), playing: false },
      all,
    );
    expect(parked.light).toBe(false);
  });

  it('keys on behaviour, not the type id, so new types need no client code', () => {
    const look = npcLook(
      input({ ...stocker, type: 'night_guard', behaviour: 'security' }, { sheet: 'security' }),
      all,
    );
    expect(look.anim).toBe('security/idle_left');
  });
});

describe('npcMelee', () => {
  it('reads the swing of each worker type from npcs.json', () => {
    const c = getNpcCatalogue();
    expect(npcMelee(c.get('stocker'))).toMatchObject({ rangePx: 30, arcDegrees: 90 });
    expect(npcMelee(c.get('security'))).toMatchObject({ rangePx: 32 });
    expect(npcMelee(c.get('butcher'))).toMatchObject({ rangePx: 34, arcDegrees: 100 });
    expect(npcMelee(c.get('forklift'))).toBeNull();
    expect(npcMelee(undefined)).toBeNull();
  });
});

describe('forklift beeps', () => {
  it('beeps every interval while driving, never while stopped', () => {
    expect(forkliftBeepDue(true, -Infinity, 5, 0.8)).toBe(5);
    expect(forkliftBeepDue(true, 5, 5.5, 0.8)).toBeNull();
    expect(forkliftBeepDue(true, 5, 5.9, 0.8)).toBe(5.9);
    expect(forkliftBeepDue(false, -Infinity, 5, 0.8)).toBeNull();
  });

  it('runs while driving or blocked by a cart, not at a corner stop', () => {
    expect(forkliftBeeping({ mode: 'drive', moving: true, alive: true }, true)).toBe(true);
    expect(forkliftBeeping({ mode: 'blocked', moving: false, alive: true }, true)).toBe(true);
    expect(forkliftBeeping({ mode: 'corner', moving: false, alive: true }, true)).toBe(false);
    expect(forkliftBeeping({ mode: 'idle', moving: true, alive: true }, true)).toBe(false);
    expect(forkliftBeeping({ mode: 'something_new', moving: true, alive: true }, true)).toBe(true);
  });

  it('never beeps outside the playing phase (countdown, results, podium; M5 review F3)', () => {
    expect(forkliftBeeping({ mode: 'drive', moving: false, alive: true }, false)).toBe(false);
    expect(forkliftBeeping({ mode: 'blocked', moving: false, alive: true }, false)).toBe(false);
  });

  it('fades with distance from the listener', () => {
    expect(hearingVolume({ x: 0, y: 0 }, { x: 0, y: 0 }, 320)).toBe(1);
    expect(hearingVolume({ x: 160, y: 0 }, { x: 0, y: 0 }, 320)).toBeCloseTo(0.5);
    expect(hearingVolume({ x: 400, y: 0 }, { x: 0, y: 0 }, 320)).toBe(0);
    expect(hearingVolume({ x: 0, y: 0 }, null, 320)).toBe(0);
  });
});

describe('npcTypeFromId', () => {
  it('strips the number suffix', () => {
    expect(npcTypeFromId('stocker_2')).toBe('stocker');
    expect(npcTypeFromId('night_guard_10')).toBe('night_guard');
    expect(npcTypeFromId('butcher')).toBe('butcher');
  });
});
