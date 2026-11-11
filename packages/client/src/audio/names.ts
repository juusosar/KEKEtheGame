// The sound effect names (§12). One generated WAV per name in public/assets/audio/ (tools/gen-sfx.ts reads
// this list, and its test checks every name has a committed file). Pure: no DOM, so tools can import it.

export const SFX_NAMES = [
  // Combat (M4).
  'swing',
  'hit',
  'throw',
  'splat',
  'pop',
  'spray',
  'slip',
  'block',
  'ko',
  'respawn',
  // Items and vans (M3).
  'pickup',
  'drop',
  'deposit',
  // Round flow (M3).
  'countdown',
  'countdownGo',
  'roundEnd',
  // Store workers (M5).
  'forkliftBeep',
  'wantedAlarm',
  'wantedAlarmFar',
  'wantedRefresh',
  // Race (M6).
  'boxPacked',
  'delivery',
  // Ambient loops placed on the map (P2-6). Played with AudioEngine.startLoop, not as one-shots.
  'bottleHum',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** Where a sound effect is served from, relative to the page. */
export function sfxUrl(name: SfxName): string {
  return `assets/audio/${name}.wav`;
}
