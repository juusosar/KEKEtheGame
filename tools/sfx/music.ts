// The placeholder music loop (§12: one looping chiptune track per map). A short score rendered with the
// SFX synth: lead (square), arpeggio (thin square), bass (triangle) and noise/sine drums. The loop length
// is a whole number of bars and note tails wrap round to the start, so it loops without a seam.
import { SAMPLE_RATE, clip, renderLayer, type Layer } from './synth';

/** One note: MIDI number (60 = middle C) or null for a rest, and its length in sixteenths. */
export type Note = readonly [number | null, number];

export interface MusicSpec {
  bpm: number;
  /** One chord per bar, as MIDI numbers (root first). */
  chords: readonly (readonly number[])[];
  /** Lead melody, sixteen sixteenths per bar. */
  melody: readonly Note[];
}

const C = [48, 52, 55];
const AM = [45, 48, 52];
const F = [41, 45, 48];
const G = [43, 47, 50];

/** Bright, bouncy store tune in C major: C - Am - F - G twice. Original placeholder. */
export const STORE_TUNE: MusicSpec = {
  bpm: 128,
  chords: [C, AM, F, G, C, AM, F, G],
  // One bar per line.
  // prettier-ignore
  melody: [
    [76, 4], [79, 2], [76, 2], [72, 4], [74, 2], [76, 2],
    [72, 4], [69, 4], [76, 4], [null, 4],
    [77, 2], [76, 2], [74, 2], [72, 2], [69, 4], [72, 4],
    [74, 6], [71, 2], [67, 4], [null, 4],
    [76, 2], [76, 2], [79, 2], [84, 6], [83, 2], [81, 2],
    [79, 4], [76, 4], [72, 2], [74, 2], [76, 4],
    [81, 4], [79, 2], [77, 2], [76, 2], [74, 2], [72, 4],
    [74, 4], [71, 2], [74, 2], [79, 6], [null, 2],
  ],
};

/** Music per theme id (§14: the theme file names the track; phase 2 adds the second map's tune). */
export const MUSIC: Record<string, MusicSpec> = {
  kespro: STORE_TUNE,
};

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function loopSeconds(spec: MusicSpec): number {
  return (spec.chords.length * 16 * 60) / spec.bpm / 4;
}

export function renderMusic(spec: MusicSpec): Float32Array {
  const step = 60 / spec.bpm / 4;
  const out = new Float32Array(Math.round(loopSeconds(spec) * SAMPLE_RATE));
  const add = (layer: Layer, sixteenth: number): void =>
    renderLayer(layer, out, Math.round(sixteenth * step * SAMPLE_RATE), true);

  let at = 0;
  for (const [note, len] of spec.melody) {
    if (note !== null) {
      add(
        { wave: 'square', seconds: len * step, freq: midiHz(note), gain: 0.13, release: 0.03, fade: 0.5 },
        at,
      );
    }
    at += len;
  }

  spec.chords.forEach((chord, bar) => {
    const root = chord[0] ?? 48;
    for (let s = 0; s < 16; s++) {
      const beat = bar * 16 + s;
      // Arpeggio: chord tones an octave up, every sixteenth.
      const tone = (chord[s % chord.length] ?? root) + 24;
      add({ wave: 'square', seconds: step, freq: midiHz(tone), gain: 0.045, duty: 0.25, fade: 1.5 }, beat);
      // Bass: octave-jumping eighths.
      if (s % 2 === 0) {
        const b = root - 12 + (s % 4 === 2 ? 12 : 0);
        add(
          { wave: 'triangle', seconds: step * 2, freq: midiHz(b), gain: 0.22, release: 0.03, fade: 0.4 },
          beat,
        );
      }
      // Drums: kick on 1 and 3, snare on 2 and 4, hats on the off-beat eighths.
      if (s % 8 === 0) add({ wave: 'sine', seconds: 0.14, freq: 150, freqEnd: 40, gain: 0.4, fade: 1 }, beat);
      if (s % 8 === 4)
        add({ wave: 'noise', seconds: 0.12, freq: 4000, gain: 0.12, fade: 2, seed: 10 + bar }, beat);
      if (s % 4 === 2) add({ wave: 'noise', seconds: 0.03, freq: 14000, gain: 0.05, seed: 20 + s }, beat);
    }
  });
  return clip(out);
}
