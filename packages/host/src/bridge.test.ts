import type { Envelope, HostToGame } from '@ogm/contracts/bridge';
import type { Bridge, BridgeStats, HostBridgeOptions as TransportOptions } from '@ogm/iframe-bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canApply, HostBridge, type HostBridgeOptions } from './bridge.js';

const hello: Extract<HostToGame, { t: 'hello' }>['payload'] = {
  protocol: 1,
  capabilities: [],
  mode: 'play',
  build: 'draft',
  playerIndex: 0,
};

function ready(id = 'ready-1'): Envelope<'ready', unknown> {
  return {
    v: 1,
    id,
    t: 'ready',
    payload: {
      protocol: 1,
      manifest: {
        id: 'host-test',
        sdk: '^1.0.0',
        title: 'Host Test',
        inputs: { actions: { move: 'stick', jump: 'button' } },
        presentation: { orientation: 'landscape', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
        view: 'iso',
        dimension: '3d',
        capabilities: [],
        palette: { categories: [], items: [] },
        tools: [],
        gizmos: {},
        saves: false,
        overrides: { aliases: {}, retired: [] },
      },
      marks: [['boot', 1]],
    },
  };
}

function harness(
  role: () => 'owner' | 'editor' | 'player' | 'watcher',
  options: Partial<Pick<HostBridgeOptions, 'monitorIntervalMs' | 'now' | 'onFatal' | 'readyTimeoutMs'>> = {},
) {
  let inbound!: TransportOptions['onMessage'];
  let validator!: TransportOptions['validate'];
  const sent: Envelope<string, unknown>[] = [];
  const requests: Envelope<string, unknown>[] = [];
  const stats: BridgeStats = { dropped: { tooLarge: 0, rateLimited: 0, invalid: 0 }, sent: 0, received: 0 };
  const close = vi.fn();
  const transport: Bridge = {
    ready: Promise.resolve(),
    send: (message) => {
      sent.push(message);
      stats.sent += 1;
    },
    request: async <R>(message: Envelope<string, unknown>) => {
      requests.push(message);
      return (
        message.t === 'editor.project'
          ? {
              v: 1,
              id: 'projected-1',
              replyTo: message.id,
              t: 'editor.projected',
              payload: { position: [2, 0, -1] },
            }
          : message.t === 'editor.pick'
            ? {
                v: 1,
                id: 'picked-1',
                replyTo: message.id,
                t: 'editor.picked',
                payload: { targets: [{ kind: 'entity', id: 'tree' }] },
              }
            : {
                v: 1,
                id: 'result-1',
                replyTo: message.id,
                t: 'test.result',
                payload: { ok: true, value: { rendered: true } },
              }
      ) as R;
    },
    close,
    stats: () => stats,
  };
  const bridge = new HostBridge({
    iframe: document.createElement('iframe'),
    origin: 'https://games.test',
    hello,
    role,
    monitorIntervalMs: 0,
    ...options,
    transportFactory: (_iframe, options) => {
      inbound = options.onMessage;
      validator = options.validate;
      return transport;
    },
  });
  return {
    bridge,
    close,
    inbound: (value: unknown) => inbound(value as Envelope<string, unknown>),
    validator,
    sent,
    requests,
    stats,
  };
}

afterEach(() => vi.useRealTimers());

describe('HostBridge', () => {
  it('allows mutations only for owner and editor roles', () => {
    expect(canApply('owner')).toBe(true);
    expect(canApply('editor')).toBe(true);
    expect(canApply('player')).toBe(false);
    expect(canApply('watcher')).toBe(false);
  });

  it('blocks design.apply for a watcher and sends it for an owner', async () => {
    const watcherError = vi.fn();
    const watcher = harness(() => 'watcher');
    watcher.bridge.onError(watcherError);
    watcher.inbound(ready());
    await watcher.bridge.whenReady;
    watcher.bridge.send('design.apply', { rev: 1, doc: {}, patches: [] });
    expect(watcher.sent).toHaveLength(0);
    expect(watcherError).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
    watcher.bridge.close();

    const owner = harness(() => 'owner');
    owner.inbound(ready());
    await owner.bridge.whenReady;
    owner.bridge.send('design.apply', { rev: 1, doc: {}, patches: [] });
    expect(owner.sent).toEqual([expect.objectContaining({ v: 1, t: 'design.apply' })]);
    owner.bridge.close();
  });

  // Camera is presence, not design: a room watcher must be able to drive its own Follow/Free camera.
  it('sends editor.camera for a watcher and rejects an invalid mode', async () => {
    const error = vi.fn();
    const watcher = harness(() => 'watcher');
    watcher.bridge.onError(error);
    watcher.inbound(ready());
    await watcher.bridge.whenReady;
    watcher.bridge.send('editor.camera', { mode: 'free' });
    watcher.bridge.send('editor.camera', { mode: 'follow', target: 'player_0' });
    expect(watcher.sent).toEqual([
      expect.objectContaining({ t: 'editor.camera', payload: { mode: 'free' } }),
      expect.objectContaining({ t: 'editor.camera', payload: { mode: 'follow', target: 'player_0' } }),
    ]);
    expect(() => watcher.bridge.send('editor.camera', { mode: 'orbit' } as never)).toThrow(
      'invalid editor.camera payload',
    );
    expect(watcher.sent).toHaveLength(2);
    expect(error).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
    watcher.bridge.close();
  });

  it('drops unknown and malformed inbound messages through the contract validator', () => {
    const { bridge, validator, stats } = harness(() => 'owner');
    for (const value of [
      { v: 1, id: 'x', t: 'nope', payload: {} },
      { v: 1, id: 'x', t: 'ready', payload: { protocol: 'wrong' } },
    ]) {
      if (validator(value) === null) stats.dropped.invalid += 1;
    }
    expect(bridge.dropped).toBe(2);
    bridge.close();
  });

  it('resolves correlated test requests to their value', async () => {
    const { bridge, inbound } = harness(() => 'owner');
    inbound(ready());
    await bridge.whenReady;
    await expect(bridge.request('test.renderInfo', {})).resolves.toEqual({ rendered: true });
    bridge.close();
  });

  it('projects editor coordinates through a correlated game response', async () => {
    const { bridge, inbound, requests } = harness(() => 'owner');
    inbound(ready());
    await bridge.whenReady;
    await expect(bridge.project(0.25, 0.75, 'scenery:tree')).resolves.toEqual([2, 0, -1]);
    expect(requests.at(-1)).toMatchObject({
      t: 'editor.project',
      payload: { x: 0.25, y: 0.75, prefab: 'scenery:tree' },
    });
    bridge.close();
  });

  it('picks editor targets through a correlated game response', async () => {
    const { bridge, inbound } = harness(() => 'owner');
    inbound(ready());
    await bridge.whenReady;
    await expect(bridge.pick(0.25, 0.75)).resolves.toEqual([{ kind: 'entity', id: 'tree' }]);
    bridge.close();
  });

  it('dispatches ready only once', async () => {
    const { bridge, inbound } = harness(() => 'owner');
    const onReady = vi.fn();
    bridge.on('ready', onReady);
    inbound(ready('first'));
    await bridge.whenReady;
    inbound(ready('second'));
    expect(onReady).toHaveBeenCalledTimes(1);
    bridge.close();
  });

  it('reports a protocol mismatch without accepting ready', () => {
    const { bridge, close, inbound } = harness(() => 'owner');
    const onError = vi.fn();
    bridge.onError(onError);
    const message = ready();
    inbound({ ...message, payload: { ...(message.payload as object), protocol: 2 } });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'protocol-mismatch' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails a frame that does not become ready before its deadline', async () => {
    vi.useFakeTimers();
    const onFatal = vi.fn();
    const { bridge, close } = harness(() => 'owner', { readyTimeoutMs: 10, onFatal });
    vi.advanceTimersByTime(11);
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ code: 'ready-timeout' }));
    await expect(bridge.whenReady).rejects.toMatchObject({ code: 'closed' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('still disposes after an error callback throws', () => {
    vi.useFakeTimers();
    const onFatal = vi.fn();
    const { bridge, close } = harness(() => 'owner', { readyTimeoutMs: 10, onFatal });
    bridge.onError(() => {
      throw new Error('consumer failed');
    });

    expect(() => vi.advanceTimersByTime(11)).toThrow('consumer failed');
    expect(onFatal).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails after ten transport-limit breaches in ten seconds', () => {
    vi.useFakeTimers();
    const onFatal = vi.fn();
    const { close, stats } = harness(() => 'owner', {
      monitorIntervalMs: 5,
      now: () => Date.now(),
      onFatal,
    });
    stats.dropped.invalid = 10;
    vi.advanceTimersByTime(5);
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ code: 'bridge-abuse' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
