// Checks the generated audio (§12): one WAV per sound effect name, sane lengths and levels, a music loop
// for every available theme, and that the committed files match what tools/gen-sfx.ts produces.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SFX_NAMES } from '../packages/client/src/audio/names';
import { themes } from '../packages/shared/src/theme';
import { ASSETS_DIR, generateAudio } from './sfx/generate';
import { MUSIC, loopSeconds } from './sfx/music';
import { SAMPLE_RATE, prng } from './sfx/synth';
import { decodeWav, encodeWav } from './sfx/wav';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = generateAudio();

function wavAt(path: string): Buffer {
  const buf = generated.get(path);
  if (!buf) throw new Error(`not generated: ${path}`);
  return buf;
}

function peak(samples: Int16Array): number {
  let p = 0;
  for (const s of samples) p = Math.max(p, Math.abs(s));
  return p / 32767;
}

describe('wav', () => {
  it('round-trips samples through encode and decode', () => {
    const wav = decodeWav(encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 8000));
    expect(wav.sampleRate).toBe(8000);
    expect([...wav.samples]).toEqual([0, 16384, -16383, 32767, -32767, 32767]);
  });

  it('seeded noise repeats', () => {
    const a = prng(7);
    const b = prng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('sound effects', () => {
  it.each(SFX_NAMES)('%s is short, audible and not clipped hard', (name) => {
    const wav = decodeWav(wavAt(`${ASSETS_DIR}/audio/${name}.wav`));
    expect(wav.sampleRate).toBe(SAMPLE_RATE);
    const seconds = wav.samples.length / SAMPLE_RATE;
    expect(seconds).toBeGreaterThan(0.03);
    expect(seconds).toBeLessThan(1.5);
    expect(peak(wav.samples)).toBeGreaterThan(0.1);
    expect(peak(wav.samples)).toBeLessThanOrEqual(1);
  });
});

describe('music', () => {
  it('every available theme has a loop at the path its theme file names', () => {
    for (const theme of Object.values(themes)) {
      if (!theme.available) continue;
      const spec = MUSIC[theme.id];
      if (spec === undefined) throw new Error(`no music for ${theme.id}`);
      const wav = decodeWav(wavAt(`${ASSETS_DIR}/${theme.assets.music}`));
      expect(wav.samples.length).toBe(Math.round(loopSeconds(spec) * SAMPLE_RATE));
      expect(peak(wav.samples)).toBeGreaterThan(0.2);
    }
  });

  it('loops are long enough not to wear thin (playtest 1: a 15 s loop was heard 40 times a session)', () => {
    for (const spec of Object.values(MUSIC)) expect(loopSeconds(spec)).toBeGreaterThanOrEqual(40);
  });

  it('melodies fill whole bars', () => {
    for (const spec of Object.values(MUSIC)) {
      const sixteenths = spec.melody.reduce((sum, [, len]) => sum + len, 0);
      expect(sixteenths).toBe(spec.chords.length * 16);
    }
  });
});

describe('committed files', () => {
  it.each([...generated.keys()])('%s matches the generator', (path) => {
    const file = resolve(repoRoot, path);
    expect(existsSync(file), `${path} missing: run npm run gen:sfx`).toBe(true);
    const committed = decodeWav(readFileSync(file)).samples;
    const fresh = decodeWav(wavAt(path)).samples;
    expect(committed.length).toBe(fresh.length);
    // Allow a step of rounding: Math.sin/exp may differ in the last bit between engines.
    let worst = 0;
    for (let i = 0; i < fresh.length; i++)
      worst = Math.max(worst, Math.abs((committed[i] ?? 0) - (fresh[i] ?? 0)));
    expect(worst, `${path} is stale: run npm run gen:sfx`).toBeLessThanOrEqual(2);
  });
});
