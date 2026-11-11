// A small jsfxr-style synthesiser (§12): each sound is a few layers, each one oscillator with a pitch
// slide or step sequence, an attack/release envelope and an optional fade. Noise is sample-and-hold at
// the layer's frequency, so its pitch shapes it (low = rumble, high = hiss), as in sfxr.
// Pure and deterministic: noise comes from a seeded PRNG.

export const SAMPLE_RATE = 22050;

export type Wave = 'square' | 'saw' | 'triangle' | 'sine' | 'noise';

export interface Layer {
  wave: Wave;
  /** Start time within the sound, seconds. */
  at?: number;
  seconds: number;
  /** Start frequency, Hz. */
  freq: number;
  /** End frequency, Hz (exponential slide from `freq`). */
  freqEnd?: number;
  /** Frequencies stepped through in equal parts of the layer, Hz (overrides the slide). */
  steps?: readonly number[];
  /** Square duty cycle 0..1 (default 0.5). */
  duty?: number;
  /** Peak level 0..1. */
  gain: number;
  /** Linear fade-in, seconds. */
  attack?: number;
  /** Linear fade-out at the end, seconds. */
  release?: number;
  /** Shapes the body: the level is multiplied by (1 - progress)^fade. */
  fade?: number;
  vibratoHz?: number;
  /** Vibrato depth as a fraction of the frequency. */
  vibratoDepth?: number;
  /** Noise seed (default 1). */
  seed?: number;
}

/** mulberry32: a tiny seeded PRNG, uniform in 0..1. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frequencyAt(layer: Layer, u: number, t: number): number {
  let f: number;
  if (layer.steps && layer.steps.length > 0) {
    const i = Math.min(layer.steps.length - 1, Math.floor(u * layer.steps.length));
    f = layer.steps[i] ?? layer.freq;
  } else if (layer.freqEnd !== undefined) {
    f = layer.freq * Math.pow(layer.freqEnd / layer.freq, u);
  } else {
    f = layer.freq;
  }
  if (layer.vibratoHz) f *= 1 + (layer.vibratoDepth ?? 0.05) * Math.sin(2 * Math.PI * layer.vibratoHz * t);
  return f;
}

function envelope(layer: Layer, t: number): number {
  const attack = layer.attack ?? 0.005;
  const release = layer.release ?? 0.01;
  let e = 1;
  if (attack > 0 && t < attack) e = t / attack;
  const left = layer.seconds - t;
  if (release > 0 && left < release) e = Math.min(e, Math.max(0, left / release));
  if (layer.fade) e *= Math.pow(1 - t / layer.seconds, layer.fade);
  return e;
}

/**
 * Adds `layer` into `out`, starting `offset` samples in. With `wrap`, samples past the end wrap round to
 * the start (seamless music loops); otherwise they are cut.
 */
export function renderLayer(layer: Layer, out: Float32Array, offset = 0, wrap = false): void {
  const count = Math.round(layer.seconds * SAMPLE_RATE);
  const start = offset + Math.round((layer.at ?? 0) * SAMPLE_RATE);
  const rand = prng(layer.seed ?? 1);
  const duty = layer.duty ?? 0.5;
  let phase = 0;
  let noise = rand() * 2 - 1;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const u = i / count;
    let v: number;
    switch (layer.wave) {
      case 'square':
        v = phase < duty ? 1 : -1;
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'triangle':
        v = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
        break;
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'noise':
        v = noise;
        break;
    }
    let j = start + i;
    if (j >= out.length) {
      if (!wrap) break;
      j %= out.length;
    }
    out[j] = (out[j] ?? 0) + v * layer.gain * envelope(layer, t);
    phase += frequencyAt(layer, u, t) / SAMPLE_RATE;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      noise = rand() * 2 - 1;
    }
  }
}

/** Renders a sound from its layers: as long as the longest layer, clipped to -1..1. */
export function renderSound(layers: readonly Layer[]): Float32Array {
  const seconds = Math.max(...layers.map((l) => (l.at ?? 0) + l.seconds));
  const out = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  for (const layer of layers) renderLayer(layer, out);
  return clip(out);
}

export function clip(out: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
  return out;
}
