import { describe, expect, it } from 'vitest';
import {
  freshNpcVitals,
  hitNpc,
  npcCanBeHit,
  npcRespawnDue,
  npcRespawnIn,
  npcSpeedMultiplier,
  npcStunned,
} from './npcHealth';

const config = { npcRespawnSeconds: 30 };
const by = { kind: 'player', id: 'p1' } as const;

describe('npc health', () => {
  it('takes damage, KOs at 0 HP and respawns after npcRespawnSeconds', () => {
    let v = freshNpcVitals(60);
    let r = hitNpc(v, 'stocker_1', { source: by, damage: 25 }, 1, config);
    expect(r).toMatchObject({ landed: true, ko: false });
    expect(r.vitals.hp).toBe(35);
    v = r.vitals;
    r = hitNpc(v, 'stocker_1', { source: by, damage: 40 }, 2, config);
    expect(r).toMatchObject({ landed: true, ko: true });
    expect(r.vitals).toMatchObject({ hp: 0, alive: false, respawnAt: 32 });
    v = r.vitals;
    expect(npcCanBeHit(v, by, 'stocker_1')).toBe(false);
    expect(hitNpc(v, 'stocker_1', { source: by, damage: 1 }, 3, config).landed).toBe(false);
    expect(npcRespawnIn(v, 2.5)).toBe(30);
    expect(npcRespawnDue(v, 31.9)).toBe(false);
    expect(npcRespawnDue(v, 32)).toBe(true);
    expect(npcSpeedMultiplier(v, 3)).toBe(0);
  });

  it('invulnerable NPCs (hp null) and an NPC hitting itself never land', () => {
    expect(npcCanBeHit(freshNpcVitals(null), by, 'forklift_1')).toBe(false);
    expect(hitNpc(freshNpcVitals(null), 'forklift_1', { source: by, damage: 99 }, 0, config).landed).toBe(
      false,
    );
    const self = { kind: 'npc', id: 'stocker_1' } as const;
    expect(npcCanBeHit(freshNpcVitals(60), self, 'stocker_1')).toBe(false);
    expect(npcCanBeHit(freshNpcVitals(60), { kind: 'hazard', id: 'forklift_1' }, 'stocker_1')).toBe(true);
  });

  it('stun keeps the longer one, slow runs out, 0-damage hits still land', () => {
    let v = freshNpcVitals(60);
    v = hitNpc(v, 's', { source: by, damage: 0, stunSeconds: 1 }, 0, config).vitals;
    v = hitNpc(v, 's', { source: by, damage: 0, stunSeconds: 0.2 }, 0.1, config).vitals;
    expect(v.hp).toBe(60);
    expect(npcStunned(v, 0.9)).toBe(true);
    expect(npcStunned(v, 1)).toBe(false);
    expect(npcSpeedMultiplier(v, 0.5)).toBe(0);
    v = hitNpc(v, 's', { source: by, damage: 0, slow: { multiplier: 0.5, seconds: 2 } }, 1, config).vitals;
    expect(npcSpeedMultiplier(v, 2)).toBe(0.5);
    expect(npcSpeedMultiplier(v, 3)).toBe(1);
  });
});
