// The page's one WebAudio graph (§12): sources → music / sfx bus → master → speakers. Sounds are the
// generated WAVs under public/assets (tools/gen-sfx.ts), fetched and decoded once. The bus gains follow
// the saved volume settings (settings.ts); every change is saved and pushed to listeners (the settings
// control). Browsers start audio suspended until the first click or key press, so the engine resumes on
// the first gesture. Audio is a nicety: without WebAudio, or with a fetch or decode failing, the game
// just stays silent.
import { browserStorage } from '../profile/storage';
import { busGains, loadAudioSettings, saveAudioSettings, type AudioSettings } from './settings';

type Listener = (settings: AudioSettings) => void;

interface Graph {
  ctx: AudioContext;
  music: GainNode;
  /** Between the music bus and the master: dips under key sounds about us (duckMusic). */
  duck: GainNode;
  sfx: GainNode;
}

/** Music level while ducked, as a share of its setting (playtest 1 idea 10). */
export const MUSIC_DUCK_LEVEL = 0.35;
/** How long the music stays ducked, and how fast it dips and comes back, seconds. */
export const MUSIC_DUCK_HOLD_SECONDS = 0.9;
const MUSIC_DUCK_ATTACK_SECONDS = 0.03;
const MUSIC_DUCK_RELEASE_SECONDS = 0.35;

export class AudioEngine {
  private settings: AudioSettings;
  private graph: Graph | null | undefined;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly listeners = new Set<Listener>();
  private musicUrl: string | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  /** Bumped on every start/stop, so a slow load never starts a track that was already stopped. */
  private musicToken = 0;

  constructor(settings: AudioSettings = loadAudioSettings(browserStorage())) {
    this.settings = settings;
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** Changes some settings, saves them and applies them at once. */
  update(change: Partial<AudioSettings>): AudioSettings {
    this.settings = saveAudioSettings(browserStorage(), { ...this.settings, ...change });
    this.applyGains();
    for (const listener of this.listeners) listener(this.getSettings());
    return this.getSettings();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resumes a suspended context; call from a user gesture. */
  unlock(): void {
    const ctx = this.graph?.ctx;
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  /** Starts fetching and decoding `url` now, so the first play has no delay. */
  preload(url: string): void {
    if (this.context() !== null) void this.load(url);
  }

  /** Plays a one-shot sound on the SFX bus at `volume` (0..1). */
  playSfx(url: string, volume: number): void {
    const graph = this.context();
    if (graph === null || !(volume > 0)) return;
    const queuedAt = graph.ctx.currentTime;
    void this.load(url).then((buffer) => {
      // A sound that took long to load is stale (a hit from half a second ago): skip it.
      if (buffer === null || graph.ctx.currentTime - queuedAt > 0.25) return;
      try {
        const source = graph.ctx.createBufferSource();
        source.buffer = buffer;
        const gain = graph.ctx.createGain();
        gain.gain.value = Math.min(1, volume);
        source.connect(gain).connect(graph.sfx);
        source.start();
      } catch {
        // Closed context or similar: stay silent.
      }
    });
  }

  /** Dips the music for a moment so a key sound about us stands out; a new dip restarts the hold. */
  duckMusic(): void {
    const graph = this.graph;
    if (!graph) return;
    try {
      const gain = graph.duck.gain;
      const now = graph.ctx.currentTime;
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(MUSIC_DUCK_LEVEL, now, MUSIC_DUCK_ATTACK_SECONDS);
      gain.setTargetAtTime(1, now + MUSIC_DUCK_HOLD_SECONDS, MUSIC_DUCK_RELEASE_SECONDS);
    } catch {
      // A closed context: nothing to duck.
    }
  }

  /** Loops `url` on the music bus (one track at a time; the same track keeps playing). */
  startMusic(url: string): void {
    if (this.musicUrl === url) return;
    this.stopMusic();
    this.musicUrl = url;
    const graph = this.context();
    if (graph === null) return;
    const token = ++this.musicToken;
    void this.load(url).then((buffer) => {
      if (buffer === null || token !== this.musicToken) return;
      try {
        const source = graph.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(graph.music);
        source.start();
        this.musicSource = source;
      } catch {
        // Stay silent.
      }
    });
  }

  stopMusic(): void {
    this.musicToken++;
    this.musicUrl = null;
    try {
      this.musicSource?.stop();
    } catch {
      // Already stopped.
    }
    this.musicSource?.disconnect();
    this.musicSource = null;
  }

  /** The track asked for, or null (debug hook; true even while the context waits for a gesture). */
  musicTrack(): string | null {
    return this.musicUrl;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(url);
    if (pending === undefined) {
      const graph = this.context();
      pending =
        graph === null
          ? Promise.resolve(null)
          : fetch(url)
              .then((res) => {
                if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
                return res.arrayBuffer();
              })
              .then((data) => graph.ctx.decodeAudioData(data))
              .catch((err: unknown) => {
                console.warn('[keke] sound failed to load', err);
                return null;
              });
      this.buffers.set(url, pending);
    }
    return pending;
  }

  private context(): Graph | null {
    if (this.graph !== undefined) return this.graph;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    try {
      if (!Ctor) throw new Error('no WebAudio');
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      const music = ctx.createGain();
      const duck = ctx.createGain();
      const sfx = ctx.createGain();
      music.connect(duck).connect(master);
      sfx.connect(master);
      this.graph = { ctx, music, duck, sfx };
      this.applyGains();
    } catch {
      this.graph = null;
    }
    return this.graph;
  }

  private applyGains(): void {
    const graph = this.graph;
    if (!graph) return;
    const gains = busGains(this.settings);
    graph.music.gain.value = gains.music;
    graph.sfx.gain.value = gains.sfx;
  }
}

let shared: AudioEngine | undefined;

/** The page's audio engine, created on first use; resumes audio on the first click or key press. */
export function audioEngine(): AudioEngine {
  if (shared === undefined) {
    const engine = new AudioEngine();
    shared = engine;
    if (typeof window !== 'undefined') {
      const unlock = (): void => engine.unlock();
      for (const type of ['pointerdown', 'keydown', 'touchend']) {
        window.addEventListener(type, unlock, { capture: true, passive: true });
      }
    }
  }
  return shared;
}
