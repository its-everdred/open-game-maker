import type { Envelope, NetServerMessage, RoomState, ServerMessage } from '@ogm/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { attachBridgeForwarding, bytesToBase64 } from './bridge-forwarding';
import { createRoomStore } from './room-store';

const pin = { gameId: 'game-1', branchId: 'main', buildId: 'build-1' };
const state = (editorSessionId = 'session-1'): RoomState => ({
  protocol: 1,
  pin,
  ownerId: 'owner-1',
  editorSessionId,
  phase: 'editing',
  phaseAt: 1,
  playRev: 0,
  lastRev: 4,
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
    'user-2': {
      userId: 'user-2',
      name: 'Sam',
      role: 'player',
      playerIndex: 1,
      connected: true,
      sessions: ['session-2'],
    },
  },
  presence: { selection: [], privateMode: false },
});

describe('bridge forwarding', () => {
  let client: FakeClient;
  let bridge: { send: Mock<(envelope: Envelope<string, unknown>) => void> };
  let store: ReturnType<typeof createRoomStore>;

  beforeEach(() => {
    client = new FakeClient();
    bridge = { send: vi.fn<(envelope: Envelope<string, unknown>) => void>() };
    store = createRoomStore();
    store.getState().welcome({ userId: 'owner-1', playerIndex: 0, sessionId: 'session-1' }, state());
  });

  it('forwards protocol 2 pause and tick messages and relays game inputs', () => {
    const forwarding = attachBridgeForwarding({ bridge, client, store });
    client.emitNet({ t: 'net.pause', epoch: 'epoch-1', tick: 42, startAt: 1000 });
    client.emitNet({
      t: 'net.seats',
      epoch: 'epoch-1',
      spectators: ['account-2'],
      seats: [
        {
          seat: 0,
          userId: 'account-secret',
          name: 'A',
          team: 0,
          connected: true,
          ready: true,
          forfeited: false,
          spectator: false,
        },
      ],
    });
    client.emitNet({ t: 'net.tick', epoch: 'epoch-1', tick: 42, serverTime: 1700 });
    expect(payloads(bridge, 'net.pause')).toEqual([{ epoch: 'epoch-1', tick: 42, startAt: 1000 }]);
    expect(JSON.stringify(payloads(bridge, 'net.seats'))).not.toContain('account-secret');
    expect(JSON.stringify(payloads(bridge, 'net.seats'))).not.toContain('account-2');
    expect(payloads(bridge, 'net.tick')).toEqual([expect.objectContaining({ tick: 42, serverMs: 1700 })]);
    forwarding.handleGameMessage(
      envelope('net.inputs', {
        epoch: 'epoch-1',
        seat: 0,
        firstTick: 42,
        frames: [{ seq: 1, tick: 42, axes: [], buttons: 0 }],
      }),
    );
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ t: 'net.inputs', epoch: 'epoch-1' }));
  });

  it('relays per-seat game events in both directions', () => {
    const forwarding = attachBridgeForwarding({ bridge, client, store });
    const event = { epoch: 'lobby', id: '1-1', seq: 1, from: 1, target: 'all' as const, data: 'e30=' };
    forwarding.handleGameMessage(envelope('net.event', event));
    expect(client.send).toHaveBeenCalledWith({ t: 'net.event', ...event });
    client.emitNet({ t: 'net.event', ...event });
    expect(payloads(bridge, 'net.event')).toContainEqual(event);
  });

  it('forwards role, phase, players, and role-gated room traffic to the game', () => {
    attachBridgeForwarding({ bridge, client, store });

    expect(payloads(bridge, 'net.role')).toEqual([{ role: 'host' }]);
    expect(payloads(bridge, 'phase')).toEqual([{ phase: 'editing' }]);
    expect(payloads(bridge, 'net.players')).toEqual([
      {
        local: 0,
        players: [
          { playerIndex: 0, name: 'Kevin', connected: true },
          { playerIndex: 1, name: 'Sam', connected: true },
        ],
      },
    ]);

    client.emit({
      t: 'input',
      f: { seq: 1, tick: 2, axes: [], buttons: 0, playerIndex: 1, from: 'user-2' },
    });
    expect(payloads(bridge, 'net.input')).toEqual([{ f: { seq: 1, tick: 2, axes: [], buttons: 0, playerIndex: 1 } }]);

    store.getState().sync(state('session-2'));
    client.emit({ t: 'snapshot', seq: 3, tick: 4, data: new Uint8Array([1, 2, 3]) });
    client.emit({
      t: 'input',
      f: { seq: 2, tick: 3, axes: [], buttons: 0, playerIndex: 1, from: 'user-2' },
    });

    expect(payloads(bridge, 'net.snapshot')).toEqual([
      { seq: 3, tick: 4, data: bytesToBase64(new Uint8Array([1, 2, 3])) },
    ]);
    expect(payloads(bridge, 'net.input')).toHaveLength(1);
  });

  it('forwards validated game traffic to the room by role and drops oversized snapshots once', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const forwarding = attachBridgeForwarding({ bridge, client, store });

    forwarding.handleGameMessage(
      envelope('net.snapshot', { seq: 1, tick: 2, data: bytesToBase64(new Uint8Array([7])) }),
    );
    expect(client.send).toHaveBeenCalledWith({ t: 'snapshot', seq: 1, tick: 2, data: new Uint8Array([7]) });

    forwarding.handleGameMessage(envelope('net.input', { f: { seq: 1, tick: 2, axes: [], buttons: 0 } }));
    expect(client.send).toHaveBeenCalledTimes(1);

    const oversized = bytesToBase64(new Uint8Array(65 * 1024));
    forwarding.handleGameMessage(envelope('net.snapshot', { seq: 2, tick: 3, data: oversized }));
    forwarding.handleGameMessage(envelope('net.snapshot', { seq: 3, tick: 4, data: oversized }));
    expect(warning).toHaveBeenCalledOnce();
  });

  it('sends peer input, phase transitions, and pause lifecycle messages without repeating the role', () => {
    const forwarding = attachBridgeForwarding({ bridge, client, store });
    store.getState().sync(state('session-2'));

    forwarding.handleGameMessage(envelope('net.input', { f: { seq: 1, tick: 2, axes: [0], buttons: 1 } }));
    expect(client.send).toHaveBeenCalledWith({ t: 'input', f: { seq: 1, tick: 2, axes: [0], buttons: 1 } });

    store.getState().sync({ ...state('session-2'), phase: 'playing' });
    store.getState().sync({ ...state('session-2'), phase: 'pausedForHost' });
    store.getState().end('host-left');

    expect(payloads(bridge, 'net.role')).toEqual([{ role: 'host' }, { role: 'peer' }]);
    expect(payloads(bridge, 'phase')).toEqual([
      { phase: 'editing' },
      { phase: 'playing' },
      { phase: 'pausedForHost' },
      { phase: 'ended' },
    ]);
    expect(types(bridge)).toContain('lifecycle.resume');
    expect(types(bridge)).toContain('lifecycle.pause');
  });

  it('acknowledges a loaded draft after the game reports ready', () => {
    const reapply = vi.fn();
    store.getState().sync({
      ...state(),
      draft: { buildId: 'build-2', url: 'https://games.example.test/build-2', expiresAt: Date.now() + 60_000 },
    });
    const forwarding = attachBridgeForwarding({ bridge, client, store, watcher: { reapply } });

    forwarding.handleGameMessage(
      envelope('ready', {
        protocol: 1,
        manifest: {
          id: 'game',
          sdk: '^1.0.0',
          title: 'Game',
          inputs: { actions: {} },
          presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
          view: 'iso',
          dimension: '3d',
          capabilities: [],
          palette: { categories: [], items: [] },
          tools: [],
          gizmos: {},
          saves: false,
          overrides: { aliases: {}, retired: [] },
        },
        marks: [],
      }),
    );

    expect(client.send).toHaveBeenCalledWith({ t: 'draft.ready', buildId: 'build-2' });
    expect(reapply).toHaveBeenCalledOnce();
  });
});

function envelope<T extends string>(t: T, payload: unknown): Envelope<T, unknown> {
  return { v: 1, id: `game-${t}`, t, payload };
}

function types(bridge: { send: Mock<(envelope: Envelope<string, unknown>) => void> }): string[] {
  return bridge.send.mock.calls.map(([message]) => (message as Envelope<string, unknown>).t);
}

function payloads(bridge: { send: Mock<(envelope: Envelope<string, unknown>) => void> }, type: string): unknown[] {
  return bridge.send.mock.calls
    .map(([message]) => message as Envelope<string, unknown>)
    .filter((message) => message.t === type)
    .map((message) => message.payload);
}

class FakeClient {
  send = vi.fn();
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly netListeners = new Set<(message: NetServerMessage) => void>();

  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: ServerMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }

  subscribeNet(listener: (message: NetServerMessage) => void): () => void {
    this.netListeners.add(listener);
    return () => this.netListeners.delete(listener);
  }

  emitNet(message: NetServerMessage): void {
    this.netListeners.forEach((listener) => listener(message));
  }
}
