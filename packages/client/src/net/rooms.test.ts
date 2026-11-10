import { describe, expect, it } from 'vitest';
import { isCompleteRoomCode, cleanCodeInput } from './rooms';

describe('room codes', () => {
  it('upper-cases, keeps letters only and stops at four', () => {
    expect(cleanCodeInput('abcd')).toBe('ABCD');
    expect(cleanCodeInput(' a-b c1d2e ')).toBe('ABCD');
    expect(cleanCodeInput('äöxy')).toBe('XY');
    expect(cleanCodeInput('')).toBe('');
  });

  it('knows when a code is complete', () => {
    expect(isCompleteRoomCode('ABCD')).toBe(true);
    expect(isCompleteRoomCode('ABC')).toBe(false);
    expect(isCompleteRoomCode('abcd')).toBe(false);
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
