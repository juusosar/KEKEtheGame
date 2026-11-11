// The sound settings control (§12): a small speaker button in the bottom-left corner, on every screen,
// that opens a panel with master / music / SFX volume sliders and a mute box. Changes apply at once and
// are saved by the audio engine. Selectors for tests:
//   #keke-audio            the control, data-muted="true|false"
//   #keke-audio-toggle     the speaker button (aria-expanded)
//   #keke-audio-panel      the panel; inputs named master, music, sfx (range 0..100) and muted (checkbox)
import { audioEngine, type AudioEngine } from '../audio/engine';
import type { AudioSettings } from '../audio/settings';
import { t } from '../i18n';
import { h } from './dom';

type Level = 'master' | 'music' | 'sfx';
const LEVELS: readonly Level[] = ['master', 'music', 'sfx'];

function icon(s: AudioSettings): string {
  if (s.muted || s.master === 0) return '🔇';
  return s.master < 0.5 ? '🔉' : '🔊';
}

/** Adds the control to the page (once); returns it. */
export function mountAudioControl(engine: AudioEngine = audioEngine()): HTMLElement {
  const existing = document.getElementById('keke-audio');
  if (existing) return existing;

  const toggle = h('button', {
    type: 'button',
    id: 'keke-audio-toggle',
    class: 'audio-toggle',
    'aria-label': t('audio.toggle'),
    'aria-controls': 'keke-audio-panel',
    'aria-expanded': false,
  });
  const fields = audioFields(engine);
  const panel = h(
    'div',
    {
      id: 'keke-audio-panel',
      class: 'audio-panel',
      role: 'group',
      'aria-label': t('audio.panel'),
      hidden: true,
    },
    ...fields.elements,
  );
  const root = h('div', { id: 'keke-audio', class: 'keke-audio' }, panel, toggle);

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  // Clicking elsewhere (or Esc) closes the panel; the game keeps its keys.
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !root.contains(e.target as Node)) setOpen(false);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    }
  });
  // Arrow keys on a focused slider must not walk the player, and WASD must not move a slider.
  root.addEventListener('keydown', (e) => e.stopPropagation());

  const render = (s: AudioSettings): void => {
    toggle.textContent = icon(s);
    root.dataset['muted'] = String(s.muted);
  };
  render(engine.getSettings());
  engine.onChange(render);
  document.body.appendChild(root);
  return root;
}

/**
 * The volume sliders and the mute box, wired to `engine` (also used by the in-game menu, F5).
 * `dispose()` stops following engine changes.
 */
export function audioFields(engine: AudioEngine = audioEngine()): {
  elements: HTMLElement[];
  dispose: () => void;
} {
  const sliders = new Map<Level, HTMLInputElement>();
  const rows = LEVELS.map((level) => {
    const input = h('input', { type: 'range', name: level, min: 0, max: 100, step: 1 });
    input.addEventListener('input', () => engine.update({ [level]: Number(input.value) / 100 }));
    sliders.set(level, input);
    return h('label', {}, h('span', {}, t(`audio.${level}`)), input);
  });
  const mute = h('input', { type: 'checkbox', name: 'muted' });
  mute.addEventListener('change', () => engine.update({ muted: mute.checked }));
  const render = (s: AudioSettings): void => {
    for (const level of LEVELS) {
      const input = sliders.get(level);
      if (input && document.activeElement !== input) input.value = String(Math.round(s[level] * 100));
    }
    mute.checked = s.muted;
  };
  render(engine.getSettings());
  const dispose = engine.onChange(render);
  return {
    elements: [...rows, h('label', { class: 'audio-mute' }, mute, h('span', {}, t('audio.mute')))],
    dispose,
  };
}
