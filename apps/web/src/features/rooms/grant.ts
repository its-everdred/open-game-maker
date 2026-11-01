import { useHostStore } from '../../app/store';

export type RoomPin = { gameId: string; branchId: string; buildId: string };
export type RoomGrant = {
  roomId: string;
  grant: string;
  pin: RoomPin;
  roomsUrl: string;
  expiresAt: number;
};

type RoomGrantSlice = { current: RoomGrant | null };

useHostStore.getState().registerSlice<RoomGrantSlice>('roomGrant', () => ({ current: null }));

const read = () => useHostStore.getState().slices.roomGrant as RoomGrantSlice;
const write = (current: RoomGrant | null) =>
  useHostStore.setState((state) => ({ slices: { ...state.slices, roomGrant: { current } } }));

function grantExpiry(token: string): number {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) throw new Error('missing payload');
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    if (typeof payload.exp !== 'number') throw new Error('missing expiry');
    return payload.exp * 1000;
  } catch {
    return Date.now() + 9 * 60 * 1000;
  }
}

export const roomGrantState = () => read().current;
export const clearRoomGrant = () => write(null);
export function storeRoomGrant(input: Omit<RoomGrant, 'expiresAt'>): RoomGrant {
  const stored = { ...input, expiresAt: grantExpiry(input.grant) };
  write(stored);
  return stored;
}
