import { describe, expect, it } from 'vitest';
import en from './en.json';
import { createTranslator, format, t } from './index';

describe('format', () => {
  it('fills placeholders', () => {
    expect(format('{who} stole {item}', { who: 'Mikko', item: 'voi' })).toBe('Mikko stole voi');
  });

  it('accepts numbers', () => {
    expect(format('{n} s left', { n: 30 })).toBe('30 s left');
  });

  it('keeps unknown placeholders visible', () => {
    expect(format('hello {name}')).toBe('hello {name}');
  });

  it('does not read inherited properties', () => {
    expect(format('{toString}', {})).toBe('{toString}');
  });
});

describe('t', () => {
  it('reads en.json', () => {
    expect(t('boot.connected')).toBe(en['boot.connected']);
  });

  it('interpolates params', () => {
    expect(t('boot.error', { message: 'timeout' })).toBe('connection failed: timeout');
  });

  it('falls back to the key when a table misses it', () => {
    const partial = createTranslator<'a' | 'b'>({ a: 'A' } as Record<'a' | 'b', string>);
    expect(partial('b')).toBe('b');
  });
});

describe('en.json', () => {
  it('holds only non-empty strings', () => {
    for (const value of Object.values(en)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
