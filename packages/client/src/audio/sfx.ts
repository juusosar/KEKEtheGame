// Sound effects (§12): the generated WAVs (tools/gen-sfx.ts) played through the shared audio engine,
// which applies the master/SFX volume and mute settings. Call sites pass a per-play volume (0..1), e.g.
// fading with distance. Every call is counted (also when audio is unavailable, blocked or muted), so e2e
// specs can latch on the count.
import { audioEngine, type AudioEngine } from './engine';
import { SFX_NAMES, sfxUrl, type SfxName } from './names';

export type { SfxName } from './names';

export class Sfx {
  private readonly counts = Object.fromEntries(SFX_NAMES.map((n) => [n, 0])) as Record<SfxName, number>;

  constructor(private readonly engine: AudioEngine = audioEngine()) {
    for (const name of SFX_NAMES) engine.preload(sfxUrl(name));
  }

  /** Plays `name` at `volume` (0..1). Silent volumes are skipped and not counted. */
  play(name: SfxName, volume = 1): void {
    if (!(volume > 0)) return;
    this.counts[name]++;
    this.engine.playSfx(sfxUrl(name), Math.min(1, volume));
  }

  /** How many times each sound was played (debug hook). */
  played(): Record<SfxName, number> {
    return { ...this.counts };
  }
}
