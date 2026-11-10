import { describe, expect, it } from 'vitest';
import raw from './render-config.json';
import { parseRenderConfig, renderConfig } from './renderConfig';

describe('render config', () => {
  it('loads the bundled render-config.json', () => {
    expect(renderConfig.cameraZoom).toBe(2);
  });

  it('rejects a non-integer zoom and an unknown hat, listing both', () => {
    expect(() => parseRenderConfig({ ...raw, cameraZoom: 1.5, defaultHat: 'tophat' })).toThrow(
      /cameraZoom[\s\S]*defaultHat/,
    );
  });
});
