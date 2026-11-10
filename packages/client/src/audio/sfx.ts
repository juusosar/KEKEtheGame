// Placeholder sound effects (M5-7), synthesised with WebAudio so there are no audio files yet. §12 plans
// jsfxr-style SFX, music and volume settings for M7; that work replaces `synth` below with loaded sounds
// and wires the volume, keeping `play(name, volume)` as the call sites' API.
// Every call is counted (also when audio is unavailable or blocked), so e2e specs can latch on the count.

export type SfxName =
  'wantedAlarm' | 'wantedAlarmFar' | 'wantedRefresh' | 'forkliftBeep' | 'boxPacked' | 'delivery';

/** Master gain for the placeholder sounds (no settings screen until M7). */
const MASTER = 0.25;

interface Tone {
  /** Hz per step. */
  freqs: number[];
  stepSeconds: number;
  type: OscillatorType;
  gain: number;
}

const SOUNDS: Record<SfxName, Tone> = {
  // Two-tone siren for "you are now Wanted".
  wantedAlarm: { freqs: [880, 660, 880, 660, 880, 660], stepSeconds: 0.14, type: 'square', gain: 0.7 },
  // Someone else became Wanted: the same siren, short and quiet.
  wantedAlarmFar: { freqs: [880, 660], stepSeconds: 0.12, type: 'square', gain: 0.25 },
  // A new offence restarted our timer: one blip.
  wantedRefresh: { freqs: [990], stepSeconds: 0.08, type: 'square', gain: 0.4 },
  // Reversing-forklift style beep.
  forkliftBeep: { freqs: [1250], stepSeconds: 0.12, type: 'sine', gain: 0.6 },
  // Race (M6-3): our order box is packed, a rising triad.
  boxPacked: { freqs: [523, 659, 784], stepSeconds: 0.1, type: 'triangle', gain: 0.6 },
  // Race: a box was delivered and the round ends, a short fanfare.
  delivery: { freqs: [523, 659, 784, 1047], stepSeconds: 0.12, type: 'square', gain: 0.5 },
};

export class Sfx {
  private ctx: AudioContext | null | undefined;
  private readonly counts: Record<SfxName, number> = {
    wantedAlarm: 0,
    wantedAlarmFar: 0,
    wantedRefresh: 0,
    forkliftBeep: 0,
    boxPacked: 0,
    delivery: 0,
  };

  /** Plays `name` at `volume` (0..1). Silent volumes are skipped and not counted. */
  play(name: SfxName, volume = 1): void {
    if (!(volume > 0)) return;
    this.counts[name]++;
    const ctx = this.context();
    if (ctx === null) return;
    try {
      this.synth(ctx, SOUNDS[name], Math.min(1, volume));
    } catch {
      // Audio is a nicety: a blocked or closed context never breaks the game.
    }
  }

  /** How many times each sound was played (debug hook). */
  played(): Record<SfxName, number> {
    return { ...this.counts };
  }

  destroy(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private context(): AudioContext | null {
    if (this.ctx !== undefined) return this.ctx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    try {
      this.ctx = Ctor ? new Ctor() : null;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private synth(ctx: AudioContext, tone: Tone, volume: number): void {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime;
    const end = start + tone.freqs.length * tone.stepSeconds;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    tone.freqs.forEach((f, i) => osc.frequency.setValueAtTime(f, start + i * tone.stepSeconds));
    const peak = MASTER * tone.gain * volume;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.setValueAtTime(peak, end - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  }
}
