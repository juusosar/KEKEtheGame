// Menu screens (Title, Profile, Play) draw their controls as plain HTML over the canvas: real text inputs,
// focus, Tab/Enter and screen-reader labels for free, and e2e tests can find them by role.
// Styles are in ui.css; the theme's accent colour comes in as a CSS variable.
import { getTheme, defaultThemeId } from '@keke/shared';
import Phaser from 'phaser';

type Child = Node | string | null | undefined | false;

/** Small element builder: `h('button', { type: 'button' }, 'Play')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    // aria-* attributes need literal "true"/"false"; other boolean attributes are present or absent.
    if (name.startsWith('aria-')) el.setAttribute(name, String(value));
    else if (value !== false) el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/**
 * Adds a full-screen menu layer for `scene`, removed again when the scene shuts down.
 * Mirrors the scene to `<body data-scene="…">` so e2e tests can wait on it.
 */
export function createMenuLayer(scene: Phaser.Scene, sceneName: string): HTMLDivElement {
  const layer = h('div', { class: 'keke-menu', id: `keke-${sceneName}` });
  const theme = getTheme(defaultThemeId);
  layer.style.setProperty('--keke-accent', theme.colors.primary);
  layer.style.setProperty('--keke-panel', theme.colors.secondary);
  document.body.appendChild(layer);
  document.body.dataset['scene'] = sceneName;
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => layer.remove());
  return layer;
}
