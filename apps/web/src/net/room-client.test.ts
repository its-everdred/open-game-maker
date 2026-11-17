import type { DesignTx, JoinOptions, RoomState } from '@ogm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomClient, type ClientTransport, type RoomTransport } from './room-client';
import { createRoomStore } from './room-store';

const pin = { gameId: 'game-1', branchId: 'main', buildId: 'build-1' };
const state: RoomState = {
  protocol: 1,
  pin,
  ownerId: 'owner-1',
  editorSessionId: 'session-1',
  phase: 'editing',
  phaseAt: 1,
  playRev: 0,
  lastRev: 40,
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

const tx: DesignTx = {
  branchId: 'main',
  rev: 41,
  baseRev: 40,
  actor: 'owner-1',
  kind: 'manual',
  patches: [],
};

describe('RoomClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('joins with the room contract and mirrors the welcome into the store', async () => {
    const room = new FakeRoom();
    const transport = new FakeClient(room);
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => transport });

    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });
    room.emit('welcome', { you: { userId: 'owner-1', playerIndex: 0, sessionId: 'session-1' }, state });

    expect(transport.joinById).toHaveBeenCalledWith('room-1', {
      grant: 'secret-grant',
      buildId: 'build-1',
      protocol: 2,
    });
    expect(room.send).toHaveBeenCalledWith('ping', { c: expect.any(Number) });
    expect(store.getState()).toMatchObject({
      status: 'connected',
      role: 'host',
      phase: 'editing',
      you: { userId: 'owner-1', playerIndex: 0, sessionId: 'session-1' },
    });
    expect(client.received()).toHaveLength(1);
  });

  it('sends match controls and restores the pause from room state', async () => {
    const room = new FakeRoom();
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => new FakeClient(room) });
    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });
    client.send({ t: 'match.pause.request' });
    expect(room.send).toHaveBeenCalledWith('match.pause.request', {});
    room.emit('match.pause', { by: 'owner-1', name: 'Kevin' });
    expect(store.getState().matchPause).toEqual({ by: 'owner-1', name: 'Kevin', resumeAt: 0 });
    const resumeAt = Date.now() + 3000;
    room.emit('match.resume', { at: resumeAt });
    expect(store.getState().matchPause?.resumeAt).toBe(resumeAt);
    await vi.advanceTimersByTimeAsync(2999);
    expect(store.getState().matchPause).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState().matchPause).toBeUndefined();
    room.onStateChange.emit({
      ...state,
      protocol: 2,
      seats: [],
      spectators: [],
      epoch: '',
      startAt: 0,
      pausedAt: 0,
      primarySeat: 0,
      seed: 0,
      rulesetHash: '',
      matchPausedBy: 'owner-1',
      matchPauseName: 'Kevin',
      matchResumeAt: 0,
    });
    expect(store.getState().matchPause).toEqual({ by: 'owner-1', name: 'Kevin', resumeAt: 0 });
    room.emit('match.resumed', {});
    expect(store.getState().matchPause).toBeUndefined();
  });

  it.each([
    [{ code: 'BUILD_MISMATCH', expected: pin }, 'BUILD_MISMATCH'],
    [{ code: 'ROOM_FULL', max: 4 }, 'ROOM_FULL'],
    [{ code: 'GRANT_INVALID' }, 'GRANT_INVALID'],
    [{ code: 'GRANT_REVOKED' }, 'GRANT_REVOKED'],
    [{ code: 'PROTOCOL_MISMATCH' }, 'PROTOCOL_MISMATCH'],
  ] as const)('keeps a structured join rejection for %s', async (rejection, code) => {
    const transport = new FakeClient(new FakeRoom());
    transport.joinById.mockRejectedValueOnce(new Error(JSON.stringify(rejection)));
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => transport });

    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });

    expect(store.getState()).toMatchObject({ status: 'rejected', rejection: { code } });
  });

  it('keeps an expired rejection when the replacement grant cannot be fetched', async () => {
    const transport = new FakeClient(new FakeRoom());
    transport.joinById.mockRejectedValueOnce(new Error('{"code":"GRANT_EXPIRED"}'));
    const fetchGrant = vi.fn(async () => Promise.reject(new Error('offline')));
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, fetchGrant, clientFactory: () => transport });

    await client.join({ roomId: 'room-1', grant: 'expired-secret', pin, expiresAt: Date.now() + 120_000 });

    expect(fetchGrant).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ status: 'rejected', rejection: { code: 'GRANT_EXPIRED' } });
  });

  it('maps an unreadable rejection without leaking the grant', async () => {
    const transport = new FakeClient(new FakeRoom());
    transport.joinById.mockRejectedValueOnce(new Error('request with secret-grant failed'));
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => transport });

    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });

    expect(store.getState()).toMatchObject({ status: 'rejected', rejection: { code: 'GRANT_INVALID' } });
    expect(JSON.stringify(store.getState())).not.toContain('secret-grant');
  });

  it('refreshes a grant sixty seconds before expiry', async () => {
    const room = new FakeRoom();
    const transport = new FakeClient(room);
    const store = createRoomStore();
    const fetchGrant = vi.fn(async () => ({ grant: 'new-secret', pin, expiresAt: Date.now() + 600_000 }));
    const client = new RoomClient({
      roomsUrl: 'ws://rooms.test',
      store,
      fetchGrant,
      clientFactory: () => transport,
    });

    await client.join({ roomId: 'room-1', grant: 'old-secret', pin, expiresAt: Date.now() + 61_000 });
    await vi.advanceTimersByTimeAsync(1_001);

    expect(fetchGrant).toHaveBeenCalledOnce();
    expect(fetchGrant).toHaveBeenCalledWith('room-1');
  });

  it('fetches one replacement grant and retries an expired join', async () => {
    const room = new FakeRoom();
    const transport = new FakeClient(room);
    transport.joinById.mockRejectedValueOnce(new Error('join rejected: {"code":"GRANT_EXPIRED"}'));
    const fetchGrant = vi.fn(async () => ({ grant: 'replacement-secret', pin, expiresAt: Date.now() + 600_000 }));
    const store = createRoomStore();
    const client = new RoomClient({
      roomsUrl: 'ws://rooms.test',
      store,
      fetchGrant,
      clientFactory: () => transport,
    });

    await client.join({ roomId: 'room-1', grant: 'expired-secret', pin, expiresAt: Date.now() + 120_000 });

    expect(fetchGrant).toHaveBeenCalledOnce();
    expect(transport.joinById).toHaveBeenLastCalledWith('room-1', {
      grant: 'replacement-secret',
      buildId: 'build-1',
      protocol: 2,
    });
    expect(store.getState().status).toBe('connecting');
  });

  it('reconnects an unconsented close with the room token', async () => {
    const room = new FakeRoom();
    room.reconnectionToken = 'room-1:token-1';
    const reconnected = new FakeRoom();
    const transport = new FakeClient(room);
    transport.reconnect.mockResolvedValueOnce(reconnected);
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => transport });
    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });

    room.emitLeave(1006);
    await vi.runOnlyPendingTimersAsync();

    expect(transport.reconnect).toHaveBeenCalledWith('room-1:token-1');
    expect(store.getState().status).toBe('connected');
  });

  it('discards a reconnect that completes after a consented leave', async () => {
    const room = new FakeRoom();
    const reconnected = new FakeRoom();
    const pending = deferred<RoomTransport>();
    const transport = new FakeClient(room);
    transport.reconnect.mockReturnValueOnce(pending.promise);
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => transport });
    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });

    room.emitLeave(1006);
    expect(transport.reconnect).toHaveBeenCalledOnce();
    await client.leave(true);
    pending.resolve(reconnected);
    await vi.advanceTimersByTimeAsync(0);

    expect(reconnected.leave).toHaveBeenCalledWith(true);
    expect(store.getState().status).toBe('idle');
  });

  it('drops an oversized snapshot and warns only once', async () => {
    const room = new FakeRoom();
    const transport = new FakeClient(room);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', clientFactory: () => transport });
    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });
    const message = { t: 'snapshot' as const, seq: 1, tick: 1, data: new Uint8Array(65 * 1024) };

    client.send(message);
    client.send(message);

    expect(room.send).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
  });

  it('routes store actions explicitly and records an ended message', async () => {
    const room = new FakeRoom();
    const transport = new FakeClient(room);
    const store = createRoomStore();
    const client = new RoomClient({ roomsUrl: 'ws://rooms.test', store, clientFactory: () => transport });
    await client.join({ roomId: 'room-1', grant: 'secret-grant', pin, expiresAt: Date.now() + 120_000 });
    room.emit('welcome', { you: { userId: 'owner-1', playerIndex: 0, sessionId: 'session-1' }, state });

    store.getState().publishTransaction(tx);
    expect(room.send).toHaveBeenCalledWith('design.tx', { tx });

    room.emit('ended', { reason: 'host-left' });
    expect(store.getState()).toMatchObject({ status: 'ended', ended: 'host-left' });
  });
});

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
  private readonly messageHandlers = new Set<(type: string | number, payload: unknown) => void>();
  readonly onStateChange = signal<(state: unknown) => void>();
  readonly onLeave = signal<(code: number, reason?: string) => void>();

  onMessage(type: '*', listener: (type: string | number, payload: unknown) => void): () => void {
    expect(type).toBe('*');
    this.messageHandlers.add(listener);
    return () => this.messageHandlers.delete(listener);
  }

  emit(type: string, payload: unknown): void {
    this.messageHandlers.forEach((listener) => listener(type, payload));
  }

  emitLeave(code: number): void {
    this.onLeave.emit(code);
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
