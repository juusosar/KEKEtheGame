import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { NORMAL_ITEM_VALUE, itemValue } from './scoring';

describe('itemValue (§3 step 5, §10.1)', () => {
  const config = loadConfig();

  it('scores a normal item 1 point', () => {
    expect(NORMAL_ITEM_VALUE).toBe(1);
    expect(itemValue('normal', config)).toBe(1);
  });

  it('scores a joke item jokeItemValue points (2 by default)', () => {
    expect(itemValue('joke', config)).toBe(2);
    expect(itemValue('joke', { jokeItemValue: 5 })).toBe(5);
  });
});
