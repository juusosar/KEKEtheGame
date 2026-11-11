// Builds every generated audio file in memory (§12). Pure: the committed files can be checked against it.
import { themes } from '../../packages/shared/src/theme';
import { SFX_NAMES } from '../../packages/client/src/audio/names';
import { MUSIC, renderMusic } from './music';
import { SOUNDS } from './sounds';
import { SAMPLE_RATE, renderSound } from './synth';
import { encodeWav } from './wav';

/** Where the client serves assets from, relative to the repo root (§15.2). */
export const ASSETS_DIR = 'packages/client/public/assets';

/** Repo-relative path → WAV bytes. */
export function generateAudio(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of SFX_NAMES) {
    files.set(`${ASSETS_DIR}/audio/${name}.wav`, encodeWav(renderSound(SOUNDS[name]), SAMPLE_RATE));
  }
  for (const theme of Object.values(themes)) {
    const spec = MUSIC[theme.id];
    if (!theme.available || spec === undefined) continue;
    files.set(`${ASSETS_DIR}/${theme.assets.music}`, encodeWav(renderMusic(spec), SAMPLE_RATE));
  }
  return files;
}
