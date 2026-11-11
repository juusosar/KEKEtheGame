import { describe, expect, it } from 'vitest';
import type { AmbientSound } from '@keke/shared';
import { AMBIENT_LEVEL, AmbientSounds, ambientVolumes } from './ambient';
import type { AudioEngine, LoopHandle } from './engine';

const hum: AmbientSound = { x: 0, y: 0, sound: 'bottleHum', radius: 300 };

/** Records loops started on it instead of playing them. */
function fakeEngine() {
  const loops: { url: string; volume: number; stopped: boolean }[] = [];
  const engine = {
    startLoop(url: string, volume: number): LoopHandle {
      const loop = { url, volume, stopped: false };
      loops.push(loop);
      return {
        setVolume: (v) => {
          loop.volume = v;
        },
        stop: () => {
          loop.stopped = true;
        },
      };
    },
  } as unknown as AudioEngine;
  return { engine, loops };
}

describe('ambientVolumes', () => {
  it('is full at the source, fades with distance and is silent at the radius', () => {
    expect(ambientVolumes([hum], { x: 0, y: 0 })).toEqual([AMBIENT_LEVEL]);
    expect(ambientVolumes([hum], { x: 150, y: 0 })[0]).toBeCloseTo(AMBIENT_LEVEL / 2);
    expect(ambientVolumes([hum], { x: 0, y: 300 })).toEqual([0]);
    expect(ambientVolumes([hum], null)).toEqual([0]);
  });
});

describe('AmbientSounds', () => {
  it('loops each known sound from silence and follows the listener', () => {
    const { engine, loops } = fakeEngine();
    const ambient = new AmbientSounds([hum], engine);
    ambient.start();
    expect(loops).toEqual([{ url: 'assets/audio/bottleHum.wav', volume: 0, stopped: false }]);
    ambient.update({ x: 0, y: 0 });
    expect(loops[0]?.volume).toBe(AMBIENT_LEVEL);
    expect(ambient.levels()).toEqual([{ sound: 'bottleHum', volume: AMBIENT_LEVEL }]);
    ambient.update({ x: 1000, y: 0 });
    expect(loops[0]?.volume).toBe(0);
  });

  it('skips sounds the client does not know', () => {
    const { engine, loops } = fakeEngine();
    const ambient = new AmbientSounds([{ ...hum, sound: 'mystery' }], engine);
    ambient.start();
    ambient.update({ x: 0, y: 0 });
    expect(loops).toEqual([]);
    expect(ambient.levels()).toEqual([]);
  });

  it('stops its loops (and restarts cleanly)', () => {
    const { engine, loops } = fakeEngine();
    const ambient = new AmbientSounds([hum], engine);
    ambient.start();
    ambient.start();
    expect(loops.map((l) => l.stopped)).toEqual([true, false]);
    ambient.stop();
    expect(loops.every((l) => l.stopped)).toBe(true);
    expect(ambient.levels()).toEqual([]);
  });
});
