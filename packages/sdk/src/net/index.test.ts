import type { GameManifest, MultiplayerHooks } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { encodeBase64, packJson } from './codec.js';
import { createNetController } from './index.js';
import { createFixtureGame } from './test/fixture-game.js';

const manifest = { inputs: { actions: {} } } as GameManifest;
const hooks: MultiplayerHooks = {
  spawn() {},
  despawn() {},
  snapshot: () => ({ tick: 0, state: {} }),
  applySnapshot() {},
  hud: () => ({}),
};
const event = (seq: number, value: unknown) => ({
  seq,
  data: encodeBase64(packJson(value, 16_384, 'event')),
});

describe('GmNet controller', () => {
  it('forwards per-seat readiness and start requests until disposed', () => {
    const send = vi.fn();
    const controller = createNetController({
      manifest: { ...manifest, net: { authority: 'per-seat', maxSeats: 4 } } as GameManifest,
      hooks: createFixtureGame([0]),
      localPlayerIndex: 0,
      send,
      acceptInput: vi.fn(),
      syncPlayers: vi.fn(),
      setLocalPlayerIndex: vi.fn(),
      recordEvent: vi.fn(),
      now: () => 0,
    });
    controller.net.setReady(true);
    controller.net.setReady(false);
    controller.net.requestStart();
    expect(send.mock.calls).toEqual([
      ['net.ready', { ready: true }],
      ['net.ready', { ready: false }],
      ['net.start.request', {}],
    ]);
    controller.dispose();
    controller.net.requestStart();
    controller.net.setReady(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('delivers reliable events in sequence order without reporting a gap that closes in time', () => {
    const controller = createNetController({
      manifest,
      hooks,
      localPlayerIndex: 0,
      send: vi.fn(),
      acceptInput: vi.fn(),
      syncPlayers: vi.fn(),
      setLocalPlayerIndex: vi.fn(),
      recordEvent: vi.fn(),
      now: () => 0,
    });
    const received: unknown[] = [];
    controller.net.onEvent((value) => received.push(value));

    controller.handleMessage('net.event', event(2, 'second'));
    controller.handleMessage('net.event', event(2, 'second'));
    controller.handleMessage('net.event', event(1, 'first'));

    expect(received).toEqual(['first', 'second']);
    expect(controller.diagnostics.eventGaps).toBe(0);
  });

  it('skips a missing event after two seconds and resumes ordered delivery', () => {
    let now = 0;
    const controller = createNetController({
      manifest,
      hooks,
      localPlayerIndex: 0,
      send: vi.fn(),
      acceptInput: vi.fn(),
      syncPlayers: vi.fn(),
      setLocalPlayerIndex: vi.fn(),
      recordEvent: vi.fn(),
      now: () => now,
    });
    const received: unknown[] = [];
    controller.net.onEvent((value) => received.push(value));

    controller.handleMessage('net.event', event(2, 'second'));
    now = 1_999;
    controller.render();
    expect(received).toEqual([]);

    now = 2_000;
    controller.render();
    expect(received).toEqual(['second']);
    expect(controller.diagnostics.eventGaps).toBe(1);
  });

  it('delivers single-player events locally without bridge traffic and warns once for oversized events', () => {
    const send = vi.fn();
    const warn = vi.fn();
    const controller = createNetController({
      manifest,
      hooks,
      localPlayerIndex: 0,
      send,
      acceptInput: vi.fn(),
      syncPlayers: vi.fn(),
      setLocalPlayerIndex: vi.fn(),
      recordEvent: vi.fn(),
      now: () => 0,
      warn,
    });
    const received = vi.fn();
    controller.net.onEvent(received);

    controller.net.sendEvent({ ready: true });
    controller.net.sendEvent({ padding: 'x'.repeat(17_000) });
    controller.net.sendEvent({ padding: 'x'.repeat(18_000) });

    expect(received).toHaveBeenCalledExactlyOnceWith({ ready: true });
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(controller.diagnostics.oversized).toBe(2);
    expect(controller.diagnostics.dropped).toBe(2);
  });

  it('numbers multiplayer events in send order', () => {
    const send = vi.fn();
    const controller = createNetController({
      manifest,
      hooks,
      localPlayerIndex: 0,
      send,
      acceptInput: vi.fn(),
      syncPlayers: vi.fn(),
      setLocalPlayerIndex: vi.fn(),
      recordEvent: vi.fn(),
      now: () => 0,
    });
    controller.handleMessage('net.players', {
      local: 0,
      players: [
        { playerIndex: 0, name: 'Host', connected: true },
        { playerIndex: 1, name: 'Peer', connected: true },
      ],
    });

    controller.net.sendEvent({ value: 'first' });
    controller.net.sendEvent({ value: 'second' });

    expect(send.mock.calls).toEqual([
      ['net.event', expect.objectContaining({ seq: 1 })],
      ['net.event', expect.objectContaining({ seq: 2 })],
    ]);
  });
});
