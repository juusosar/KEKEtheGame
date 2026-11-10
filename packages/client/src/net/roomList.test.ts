import { describe, expect, it } from 'vitest';
import { addRoom, isJoinable, removeRoom, setRooms, toRoomSummary } from './roomList';

const listing = (roomId: string, code: string, phase = 'lobby', clients = 1) => ({
  roomId,
  clients,
  maxClients: 16,
  metadata: { code, hostName: `host of ${code}`, mode: 'timed', phase },
});

describe('room list', () => {
  it('reads a listing entry', () => {
    expect(toRoomSummary(listing('r1', 'ABCD'))).toEqual({
      roomId: 'r1',
      code: 'ABCD',
      hostName: 'host of ABCD',
      clients: 1,
      maxClients: 16,
      phase: 'lobby',
      mode: 'timed',
    });
  });

  it('drops entries without an id or a code and tolerates odd metadata', () => {
    expect(toRoomSummary({ roomId: 'r1' })).toBeNull();
    expect(toRoomSummary({ metadata: { code: 'ABCD' } })).toBeNull();
    expect(toRoomSummary(null)).toBeNull();
    expect(toRoomSummary({ roomId: 'r', metadata: { code: 'WXYZ', phase: 'nap' } })).toMatchObject({
      phase: null,
      hostName: '',
      clients: 0,
    });
  });

  it('sorts lobby rooms first, then by code', () => {
    const list = setRooms([
      listing('a', 'ZZZZ'),
      listing('b', 'MMMM', 'playing'),
      listing('c', 'AAAA'),
      'junk',
    ]);
    expect(list.map((r) => r.code)).toEqual(['AAAA', 'ZZZZ', 'MMMM']);
    expect(setRooms('nope')).toEqual([]);
  });

  it('applies + and - updates', () => {
    let list = setRooms([listing('a', 'BBBB')]);
    list = addRoom(list, ['c', { clients: 2, maxClients: 16, metadata: { code: 'AAAA', phase: 'lobby' } }]);
    expect(list.map((r) => r.code)).toEqual(['AAAA', 'BBBB']);
    list = addRoom(list, ['a', { clients: 5, maxClients: 16, metadata: { code: 'BBBB', phase: 'lobby' } }]);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.roomId === 'a')?.clients).toBe(5);
    list = removeRoom(list, 'c');
    expect(list.map((r) => r.roomId)).toEqual(['a']);
    expect(addRoom(list, 'bad')).toEqual(list);
  });

  it('knows when a room is full', () => {
    const room = toRoomSummary(listing('a', 'ABCD', 'lobby', 16));
    expect(room && isJoinable(room)).toBe(false);
    const open = toRoomSummary(listing('a', 'ABCD', 'playing', 3));
    expect(open && isJoinable(open)).toBe(true);
  });
});
