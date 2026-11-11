// The placeholder sound effects (§12), as synth layers (synth.ts). One entry per SFX_NAMES name.
// Levels are set relative to each other here; the player's volume settings scale them all in the client.
import type { SfxName } from '../../packages/client/src/audio/names';
import type { Layer } from './synth';

export const SOUNDS: Record<SfxName, readonly Layer[]> = {
  // A whoosh: hiss falling in pitch.
  swing: [{ wave: 'noise', seconds: 0.14, freq: 6000, freqEnd: 1200, gain: 0.3, attack: 0.03, fade: 1.2 }],
  // Punch: a dropping square thump with a crack of noise on top.
  hit: [
    { wave: 'square', seconds: 0.13, freq: 240, freqEnd: 60, gain: 0.4, fade: 1.5 },
    { wave: 'noise', seconds: 0.05, freq: 3500, gain: 0.35, fade: 1, seed: 2 },
  ],
  // Throw: a quick rising swish.
  throw: [
    { wave: 'noise', seconds: 0.18, freq: 1500, freqEnd: 5000, gain: 0.22, attack: 0.04, fade: 1 },
    { wave: 'triangle', seconds: 0.14, freq: 300, freqEnd: 700, gain: 0.15, fade: 1 },
  ],
  // Splat (egg, ketchup, bottle): wet low noise and a soft thud.
  splat: [
    { wave: 'noise', seconds: 0.24, freq: 1400, freqEnd: 250, gain: 0.4, fade: 1.6, seed: 3 },
    { wave: 'sine', seconds: 0.12, freq: 170, freqEnd: 60, gain: 0.4, fade: 1 },
  ],
  // Champagne cork.
  pop: [
    { wave: 'square', seconds: 0.06, freq: 1100, freqEnd: 350, gain: 0.35, duty: 0.3, fade: 1 },
    { wave: 'noise', seconds: 0.2, at: 0.03, freq: 7000, gain: 0.12, fade: 2, seed: 4 },
  ],
  // Ketchup squirt / extinguisher blast: a steady hiss.
  spray: [
    {
      wave: 'noise',
      seconds: 0.32,
      freq: 9000,
      freqEnd: 6000,
      gain: 0.2,
      attack: 0.03,
      release: 0.12,
      seed: 5,
    },
  ],
  // Banana slip: slide whistle up, then a bump.
  slip: [
    { wave: 'sine', seconds: 0.24, freq: 450, freqEnd: 1500, gain: 0.3, vibratoHz: 14, vibratoDepth: 0.03 },
    { wave: 'square', at: 0.24, seconds: 0.12, freq: 130, freqEnd: 55, gain: 0.3, fade: 1.5 },
  ],
  // Frying pan block: a metallic clang.
  block: [
    { wave: 'square', seconds: 0.03, freq: 1900, gain: 0.25 },
    {
      wave: 'triangle',
      seconds: 0.35,
      freq: 940,
      freqEnd: 900,
      gain: 0.3,
      fade: 2,
      vibratoHz: 30,
      vibratoDepth: 0.02,
    },
    { wave: 'triangle', seconds: 0.3, freq: 1410, gain: 0.15, fade: 2.5 },
  ],
  // Knocked out: a wobbly falling tone and a thump.
  ko: [
    {
      wave: 'saw',
      seconds: 0.55,
      freq: 620,
      freqEnd: 90,
      gain: 0.25,
      fade: 0.8,
      vibratoHz: 9,
      vibratoDepth: 0.08,
    },
    { wave: 'noise', at: 0.45, seconds: 0.12, freq: 600, gain: 0.3, fade: 1.5, seed: 6 },
  ],
  // Back on your feet: a rising arpeggio.
  respawn: [
    { wave: 'triangle', seconds: 0.36, freq: 392, steps: [392, 523, 659, 784], gain: 0.35, release: 0.05 },
    { wave: 'sine', seconds: 0.36, freq: 1568, steps: [1568, 2093], gain: 0.06, fade: 1 },
  ],
  // Item in hand: two quick blips.
  pickup: [{ wave: 'square', seconds: 0.11, freq: 660, steps: [660, 990], gain: 0.25, duty: 0.4 }],
  // Item put down: a short falling blip.
  drop: [{ wave: 'triangle', seconds: 0.1, freq: 520, freqEnd: 240, gain: 0.3 }],
  // Deposit at the van: "ka-ching" (a click, then a bright two-note bell).
  deposit: [
    { wave: 'noise', seconds: 0.04, freq: 8000, gain: 0.25, seed: 7 },
    { wave: 'square', at: 0.05, seconds: 0.08, freq: 1319, gain: 0.18, duty: 0.25 },
    { wave: 'square', at: 0.12, seconds: 0.4, freq: 1760, gain: 0.2, duty: 0.25, fade: 1.6 },
    { wave: 'triangle', at: 0.12, seconds: 0.4, freq: 2637, gain: 0.12, fade: 2 },
  ],
  // Round intro 3-2-1 tick, then a higher "go".
  countdown: [{ wave: 'square', seconds: 0.12, freq: 660, gain: 0.25, release: 0.03 }],
  countdownGo: [
    { wave: 'square', seconds: 0.4, freq: 1320, gain: 0.22, release: 0.1 },
    { wave: 'triangle', seconds: 0.4, freq: 660, gain: 0.25, release: 0.1 },
  ],
  // Time up: a buzzer horn (two detuned saws beat against each other).
  roundEnd: [
    { wave: 'saw', seconds: 0.7, freq: 220, gain: 0.2, release: 0.1 },
    { wave: 'saw', seconds: 0.7, freq: 224, gain: 0.2, release: 0.1 },
    { wave: 'square', seconds: 0.7, freq: 110, gain: 0.12, release: 0.1 },
  ],
  // Reversing-forklift beep.
  forkliftBeep: [{ wave: 'square', seconds: 0.14, freq: 1250, gain: 0.3, release: 0.02 }],
  // You are Wanted: a two-tone siren.
  wantedAlarm: [
    {
      wave: 'square',
      seconds: 0.84,
      freq: 880,
      steps: [880, 660, 880, 660, 880, 660],
      gain: 0.25,
      release: 0.03,
    },
    {
      wave: 'saw',
      seconds: 0.84,
      freq: 440,
      steps: [440, 330, 440, 330, 440, 330],
      gain: 0.12,
      release: 0.03,
    },
  ],
  // Someone else became Wanted: the siren, short.
  wantedAlarmFar: [
    { wave: 'square', seconds: 0.24, freq: 880, steps: [880, 660], gain: 0.25, release: 0.03 },
  ],
  // An offence restarted our Wanted timer: one blip.
  wantedRefresh: [{ wave: 'square', seconds: 0.08, freq: 990, gain: 0.25 }],
  // Self-checkout gate (P2-1): the till's two-tone "please wait" beep.
  gateBeep: [
    { wave: 'square', seconds: 0.09, freq: 1568, gain: 0.22, duty: 0.25, release: 0.01 },
    { wave: 'square', at: 0.12, seconds: 0.14, freq: 1175, gain: 0.22, duty: 0.25, release: 0.03 },
  ],
  // Customers panic (P2-4): a short breathy gasp, an airy inhale over a rising "oh!".
  customerGasp: [
    { wave: 'noise', seconds: 0.22, freq: 2400, freqEnd: 4200, gain: 0.2, attack: 0.05, fade: 1.4, seed: 9 },
    {
      wave: 'triangle',
      seconds: 0.18,
      at: 0.03,
      freq: 420,
      freqEnd: 720,
      gain: 0.22,
      attack: 0.02,
      fade: 1.2,
    },
  ],
  // The bakery oven burns someone (P2-2): a hot pan hiss with fat crackling in it.
  sizzle: [
    { wave: 'noise', seconds: 0.5, freq: 7000, freqEnd: 4000, gain: 0.22, attack: 0.02, fade: 1.4, seed: 7 },
    { wave: 'noise', seconds: 0.06, freq: 2500, gain: 0.3, fade: 1, seed: 8 },
    { wave: 'noise', at: 0.14, seconds: 0.05, freq: 3000, gain: 0.25, fade: 1, seed: 9 },
    { wave: 'noise', at: 0.29, seconds: 0.04, freq: 2800, gain: 0.2, fade: 1, seed: 10 },
  ],
  // Race: our order box is packed, a rising triad.
  boxPacked: [
    { wave: 'triangle', seconds: 0.3, freq: 523, steps: [523, 659, 784], gain: 0.4, release: 0.04 },
  ],
  // Race: a box was delivered, a short fanfare.
  delivery: [
    { wave: 'square', seconds: 0.36, freq: 523, steps: [523, 659, 784], gain: 0.2, duty: 0.25 },
    { wave: 'square', at: 0.36, seconds: 0.5, freq: 1047, gain: 0.2, duty: 0.25, fade: 1 },
    { wave: 'triangle', at: 0.36, seconds: 0.5, freq: 523, gain: 0.3, fade: 1 },
  ],
  // The bottle machines' electric hum (P2-6), looped in game. One second of whole cycles with no
  // envelope, so the end joins the start without a click.
  bottleHum: [
    { wave: 'sine', seconds: 1, freq: 100, gain: 0.22, attack: 0, release: 0 },
    { wave: 'square', seconds: 1, freq: 50, gain: 0.05, attack: 0, release: 0 },
    { wave: 'triangle', seconds: 1, freq: 300, gain: 0.04, attack: 0, release: 0 },
  ],
  // The bakery oven's crackle (P2-2), looped near the hot floor: a low burner rumble in whole cycles and a
  // soft hiss with no envelope, so the loop joins without a click.
  ovenCrackle: [
    { wave: 'sine', seconds: 1, freq: 60, gain: 0.18, attack: 0, release: 0 },
    { wave: 'triangle', seconds: 1, freq: 120, gain: 0.05, attack: 0, release: 0 },
    { wave: 'noise', seconds: 1, freq: 5000, gain: 0.08, attack: 0, release: 0, seed: 11 },
  ],
};
