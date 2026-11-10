import { describe, expect, it } from 'vitest';
import { isDebugEnabled } from './debugFlag';

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
