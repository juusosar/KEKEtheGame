// Draws the minimap (§13.2) as an SVG in the bottom-right corner (the HUD keeps clear of it).
// SVG rather than a second <canvas>, so the page keeps exactly one canvas (Phaser's) and stays sharp at
// any pixel ratio. The map (floor + walls) is built once; markers are redrawn a few times a second from
// buildMinimapMarkers. Game.ts creates it, feeds it and destroys it.
import type { MapModel, MapTheme } from '@keke/shared';
import { t } from '../i18n';
import {
  MARKER_STYLES,
  fitMinimap,
  projectToMinimap,
  type MarkerShape,
  type MinimapFit,
  type MinimapMarker,
} from './minimap';

/** Largest minimap box in CSS pixels (CSS shrinks it further on small screens). */
export const MINIMAP_MAX_PX = 200;
/** Marker redraws per second: enough for 20 Hz state, cheap for a few dozen nodes. */
const REFRESH_HZ = 15;
const PULSE_SECONDS = 0.8;
const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTLINE = '#1A1A1A';

export class MinimapView {
  readonly element: SVGSVGElement;
  private readonly layer: SVGGElement;
  private readonly fit: MinimapFit;
  private sinceDraw = Infinity;
  private clock = 0;
  private lastMarkers: MinimapMarker[] = [];

  constructor(model: MapModel, theme: MapTheme) {
    this.fit = fitMinimap(model.widthPx, model.heightPx, MINIMAP_MAX_PX, MINIMAP_MAX_PX);
    const { width, height } = this.fit;

    const svg = el('svg', {
      id: 'keke-minimap',
      class: 'keke-minimap',
      role: 'img',
      'aria-label': t('game.minimap'),
      viewBox: `0 0 ${width} ${height}`,
      width: String(width),
      height: String(height),
    });
    svg.style.setProperty('--keke-minimap-accent', theme.colors.primary);
    svg.append(
      el('rect', { x: '0', y: '0', width: String(width), height: String(height), fill: theme.colors.floor }),
      el('path', { d: wallPath(model, this.fit.scale), fill: theme.colors.secondary }),
    );
    this.layer = el('g', {});
    svg.append(this.layer);
    this.element = svg;
    document.body.appendChild(svg);
  }

  /** Markers drawn by the last redraw (for the debug hook). */
  get markers(): readonly MinimapMarker[] {
    return this.lastMarkers;
  }

  /**
   * Call every frame; redraws at REFRESH_HZ. `markers` is only called when a redraw is due, so the
   * state is read a few times a second, not every frame.
   */
  update(dt: number, markers: () => MinimapMarker[]): void {
    this.clock += dt;
    this.sinceDraw += dt;
    if (this.sinceDraw < 1 / REFRESH_HZ) return;
    this.sinceDraw = 0;
    this.lastMarkers = markers();
    this.draw();
  }

  destroy(): void {
    this.element.remove();
  }

  private draw(): void {
    const pulseOn = Math.floor(this.clock / PULSE_SECONDS) % 2 === 0;
    const nodes: SVGElement[] = [];
    for (const marker of this.lastMarkers) {
      const style: { shape: MarkerShape; size: number; color: string; pulse?: boolean } =
        MARKER_STYLES[marker.kind];
      const at = projectToMinimap(this.fit, marker);
      const size = style.pulse && !pulseOn ? style.size * 0.7 : style.size;
      nodes.push(
        shape(style.shape, at.x, at.y, size, {
          fill: marker.color ?? style.color,
          stroke: OUTLINE,
          'stroke-width': '1',
          'data-kind': marker.kind,
        }),
      );
      if (marker.mine) {
        nodes.push(
          shape(style.shape, at.x, at.y, size + 4, {
            fill: 'none',
            stroke: '#FFFFFF',
            'stroke-width': '1.5',
          }),
        );
      }
    }
    this.layer.replaceChildren(...nodes);
  }
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** Wall tiles as one path, a rectangle per horizontal run of solid tiles. */
function wallPath(model: MapModel, scale: number): string {
  const ts = model.tileSize * scale;
  const parts: string[] = [];
  const r = (n: number): string => String(Math.round(n * 100) / 100);
  for (let ty = 0; ty < model.height; ty++) {
    let tx = 0;
    while (tx < model.width) {
      if (!model.collision.isSolid(tx, ty)) {
        tx++;
        continue;
      }
      const start = tx;
      while (tx < model.width && model.collision.isSolid(tx, ty)) tx++;
      parts.push(
        `M${r(start * ts)} ${r(ty * ts)}h${r((tx - start) * ts)}v${r(ts)}h${r(-(tx - start) * ts)}z`,
      );
    }
  }
  return parts.join('');
}

function shape(
  kind: MarkerShape,
  x: number,
  y: number,
  size: number,
  attrs: Record<string, string>,
): SVGElement {
  const h = size / 2;
  switch (kind) {
    case 'square':
      return el('rect', {
        ...attrs,
        x: String(x - h),
        y: String(y - h),
        width: String(size),
        height: String(size),
      });
    case 'circle':
      return el('circle', { ...attrs, cx: String(x), cy: String(y), r: String(h) });
    case 'diamond':
      return el('polygon', { ...attrs, points: `${x},${y - h} ${x + h},${y} ${x},${y + h} ${x - h},${y}` });
    case 'triangle':
      return el('polygon', { ...attrs, points: `${x},${y - h} ${x + h},${y + h} ${x - h},${y + h}` });
  }
}
