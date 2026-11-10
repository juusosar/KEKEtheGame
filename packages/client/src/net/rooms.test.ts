import { describe, expect, it } from 'vitest';
import { cleanCodeInput } from './rooms';

describe('room codes', () => {
  it('upper-cases, keeps letters only and stops at four', () => {
    expect(cleanCodeInput('abcd')).toBe('ABCD');
    expect(cleanCodeInput(' a-b c1d2e ')).toBe('ABCD');
    expect(cleanCodeInput('äöxy')).toBe('XY');
    expect(cleanCodeInput('')).toBe('');
  });
});

describe('join errors', () => {
  it('spots an unknown code', async () => {
    const { classifyJoinError } = await import('./rooms');
    expect(classifyJoinError({ code: 521, message: 'no rooms found' })).toBe('noRoom');
    expect(classifyJoinError({ code: 4404, message: 'wrong code' })).toBe('noRoom');
    expect(classifyJoinError(new Error('socket closed'))).toBe('other');
    expect(classifyJoinError('x')).toBe('other');
  });
});

describe('roomCodeOf', () => {
  it('reads state.code and falls back while the state is empty', async () => {
    const { roomCodeOf } = await import('./rooms');
    expect(roomCodeOf({ state: { code: 'KXBD' } })).toBe('KXBD');
    expect(roomCodeOf({ state: {} }, 'ABCD')).toBe('ABCD');
    expect(roomCodeOf({ state: undefined })).toBe('');
  });
});
