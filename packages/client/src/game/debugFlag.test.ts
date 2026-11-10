import { describe, expect, it } from 'vitest';
import { debugFpsLimit, isDebugEnabled } from './debugFlag';

describe('isDebugEnabled', () => {
  it('accepts ?debug=1, ?debug and ?debug=true', () => {
    expect(isDebugEnabled('?debug=1')).toBe(true);
    expect(isDebugEnabled('?debug')).toBe(true);
    expect(isDebugEnabled('?x=2&debug=true')).toBe(true);
  });

  it('is off otherwise', () => {
    expect(isDebugEnabled('')).toBe(false);
    expect(isDebugEnabled('?debug=0')).toBe(false);
    expect(isDebugEnabled('?debugger=1')).toBe(false);
  });
});

describe('debugFpsLimit', () => {
  it('caps the frame rate only with the debug flag', () => {
    expect(debugFpsLimit('?debug=1&fps=20')).toBe(20);
    expect(debugFpsLimit('?fps=20')).toBeUndefined();
    expect(debugFpsLimit('?debug=1')).toBeUndefined();
  });

  it('ignores values outside 5..120 and non-numbers', () => {
    expect(debugFpsLimit('?debug=1&fps=2')).toBeUndefined();
    expect(debugFpsLimit('?debug=1&fps=500')).toBeUndefined();
    expect(debugFpsLimit('?debug=1&fps=abc')).toBeUndefined();
    expect(debugFpsLimit('?debug=1&fps=-10')).toBeUndefined();
  });
});
