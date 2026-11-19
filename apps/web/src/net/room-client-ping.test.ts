import type { JoinOptions, RoomState, ServerMessage } from '@ogm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomClient, type ClientTransport, type RoomTransport } from './room-client';
import { createRoomStore } from './room-store';

/**
 * The ping cadence that feeds the relay transport's round trip estimator (#498 §4.4): 1 Hz while a match is playing,
 * 5 s otherwise. Reverting `RoomClient` to a fixed 5 s interval fails both cases. One ping goes out on welcome so the
 * server clock offset is known before a match-resume countdown has to be scheduled against it.
 */

const pin = { gameId: 'game-1', branchId: 'main', buildId: 'build-1' };
const state: RoomState = {
  protocol: 1,
  pin,
  ownerId: 'owner-1',
  editorSessionId: 'session-1',
  phase: 'editing',
  phaseAt: 1,
  playRev: 0,
  lastRev: 1,
  maxPlayers: 4,
  members: {
    'owner-1': {
      userId: 'owner-1',
      name: 'Kevin',
      role: 'owner',
      playerIndex: 0,
      connected: true,
      sessions: ['session-1'],
    },
  },
  presence: { selection: [], privateMode: false },
};

type ListenerSignal<T extends (...args: never[]) => unknown> = {
  (listener: T): void;
  remove(listener: T): void;
  emit(...args: Parameters<T>): void;
};

function signal<T extends (...args: never[]) => unknown>(): ListenerSignal<T> {
  const listeners = new Set<T>();
  const add = ((listener: T) => {
    listeners.add(listener);
  }) as ListenerSignal<T>;
  add.remove = (listener) => listeners.delete(listener);
  add.emit = (...args) => listeners.forEach((listener) => listener(...args));
  return add;
}

class FakeRoom implements RoomTransport {
  sessionId = 'session-1';
  reconnectionToken = 'room-1:token';
  reconnection = { enabled: true };
  send = vi.fn();
  leave = vi.fn(async () => 1000);
  private readonly handlers = new Set<(type: string | number, payload: unknown) => void>();
  readonly onStateChange = signal<(state: unknown) => void>();
  readonly onLeave = signal<(code: number, reason?: string) => void>();

  onMessage(_type: '*', listener: (type: string | number, payload: unknown) => void): () => void {
    this.handlers.add(listener);
    return () => this.handlers.delete(listener);
  }

  emit(type: ServerMessage['t'], payload: Omit<ServerMessage, 't'>): void {
    this.handlers.forEach((handler) => handler(type, payload));
  }
}

class FakeClient implements ClientTransport {
  joinById = vi.fn<(_roomId: string, _options: JoinOptions) => Promise<RoomTransport>>();
  reconnect = vi.fn<(_token: string) => Promise<RoomTransport>>();

  constructor(room: RoomTransport) {
    this.joinById.mockResolvedValue(room);
    this.reconnect.mockResolvedValue(room);
  }
}

async function connected(room: FakeRoom, options: { pingIntervalMs?: (phase?: RoomState['phase']) => number } = {}) {
  const client = new RoomClient({
    roomsUrl: 'ws://rooms.test',
    store: createRoomStore(),
    clientFactory: () => new FakeClient(room),
    ...options,
  });
  await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 1_000_000 });
  room.emit('welcome', { you: { userId: 'owner-1', playerIndex: 0, sessionId: 'session-1' }, state });
  return client;
}

function pings(room: FakeRoom): number {
  // `RoomClient.send` forwards the message type as the room's first argument.
  return room.send.mock.calls.filter(([type]) => type === 'ping').length;
}

describe('RoomClient ping cadence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pings on welcome so the clock offset is known before any countdown', async () => {
    const room = new FakeRoom();
    await connected(room);
    expect(pings(room)).toBe(1);
  });

  it('pings every 5 s while the room is editing', async () => {
    const room = new FakeRoom();
    await connected(room);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(pings(room)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pings(room)).toBe(2);
  });

  it('pings once a second while a match is playing', async () => {
    const room = new FakeRoom();
    await connected(room);
    room.onStateChange.emit({ ...state, phase: 'playing' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pings(room)).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pings(room)).toBe(4);
  });

  it('takes the cadence from an injected option', async () => {
    const room = new FakeRoom();
    await connected(room, { pingIntervalMs: () => 250 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pings(room)).toBe(5);
  });
});
