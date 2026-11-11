// Ambient loops placed on the map (P2-6), e.g. the bottle machines' hum on the second map: each one loops while
// the Game scene runs and fades with the listener's distance (full at the point, silent at its radius).
// Sounds the client does not know are skipped, so a map can name a sound before the client has it.
import type { AmbientSound, Vec2 } from '@keke/shared';
import { hearingVolume } from '../game/npcLook';
import { audioEngine, type AudioEngine, type LoopHandle } from './engine';
import { SFX_NAMES, sfxUrl, type SfxName } from './names';

/** Ambient loops sit under the game's sounds: this is their level right at the source. */
export const AMBIENT_LEVEL = 0.55;
/** Volume changes smaller than this are not sent to the engine (it glides anyway). */
const VOLUME_EPSILON = 0.01;

const isSfxName = (name: string): name is SfxName => (SFX_NAMES as readonly string[]).includes(name);

/** The volume of each sound heard from `listener` (pure; null listener = silence). */
export function ambientVolumes(sounds: readonly AmbientSound[], listener: Vec2 | null): number[] {
  return sounds.map((s) => AMBIENT_LEVEL * hearingVolume(s, listener, s.radius));
}

export class AmbientSounds {
  private readonly sounds: readonly AmbientSound[];
  private loops: (LoopHandle | null)[] = [];
  private volumes: number[];

  constructor(
    sounds: readonly AmbientSound[],
    private readonly engine: AudioEngine = audioEngine(),
  ) {
    this.sounds = sounds.filter((s) => isSfxName(s.sound));
    this.volumes = this.sounds.map(() => 0);
  }

  /** Starts every loop silent; `update` brings them up as the listener gets near. */
  start(): void {
    this.stop();
    this.loops = this.sounds.map((s) => this.engine.startLoop(sfxUrl(s.sound as SfxName), 0));
    this.volumes = this.sounds.map(() => 0);
  }

  update(listener: Vec2 | null): void {
    const next = ambientVolumes(this.sounds, listener);
    next.forEach((volume, i) => {
      if (Math.abs(volume - (this.volumes[i] ?? 0)) < VOLUME_EPSILON) return;
      this.volumes[i] = volume;
      this.loops[i]?.setVolume(volume);
    });
  }

  stop(): void {
    for (const loop of this.loops) loop?.stop();
    this.loops = [];
    this.volumes = this.volumes.map(() => 0);
  }

  /** Each running loop's sound and current volume (debug hook). */
  levels(): { sound: string; volume: number }[] {
    if (this.loops.length === 0) return [];
    return this.sounds.map((s, i) => ({ sound: s.sound, volume: this.volumes[i] ?? 0 }));
  }
}
