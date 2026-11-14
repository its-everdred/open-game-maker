import type { Envelope, GmTestHooks, HostToGame } from '@ogm/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { boot } from '../core/boot.js';
import { createCounterGame } from './fixtures/counter-game.js';

const bridge = vi.hoisted(() => ({
  onMessage: undefined as ((message: Envelope<string, unknown>) => void) | undefined,
  send: vi.fn(),
}));

vi.mock('@ogm/iframe-bridge', () => ({
  openGameBridge: vi.fn((options: { onMessage: (message: Envelope<string, unknown>) => void }) => {
    bridge.onMessage = options.onMessage;
    return {
      ready: Promise.resolve(),
      send: bridge.send,
      close: vi.fn(),
      request: vi.fn(),
      stats: () => ({ dropped: { tooLarge: 0, rateLimited: 0, invalid: 0 }, sent: 0, received: 0 }),
    };
  }),
}));

let id = 0;
const hostMessage = <T extends HostToGame['t']>(t: T, payload: Extract<HostToGame, { t: T }>['payload']) =>
  ({ v: 1, id: `host-${++id}`, t, payload }) as Extract<HostToGame, { t: T }>;

async function start() {
  const fixture = createCounterGame();
  const pending = boot(fixture.module, { hostOrigin: 'https://app.test', headless: true });
  await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
  bridge.onMessage!(
    hostMessage('hello', { protocol: 1, capabilities: ['events'], mode: 'play', build: 'test', playerIndex: 0 }),
  );
  return { ...fixture, runtime: await pending };
}

describe('runtime hooks', () => {
  beforeEach(() => {
    id = 0;
    bridge.onMessage = undefined;
    bridge.send.mockReset();
  });

  it('signals frame readiness only when the game explicitly completes boot', async () => {
    const listener = vi.fn();
    window.addEventListener('gm-frame-ready', listener);
    try {
      const { runtime } = await start();
      expect(listener).not.toHaveBeenCalled();
      runtime.hooks.ready = false;
      expect(listener).not.toHaveBeenCalled();
      runtime.hooks.ready = true;
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('gm-frame-ready', listener);
    }
  });

  it('advances sixty steps and renders once', async () => {
    const { runtime } = await start();
    const onFrame = vi.fn();
    runtime.onFrame(onFrame);

    runtime.hooks.advanceTime(1000);

    expect(runtime.clock.tick).toBe(60);
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it('consumes injected actions on only the next step', async () => {
    const { runtime } = await start();
    runtime.hooks.inject({ playerIndex: 0, tick: 0, source: 'network', actions: { go: true } });

    runtime.hooks.advanceTime(17);
    expect(runtime.instance.serialize().data.counter).toBe(1);

    runtime.hooks.advanceTime(17);
    expect(runtime.instance.serialize().data.counter).toBe(1);
  });

  it('restores the last keyframe before rendering an earlier absolute time', async () => {
    const { metrics, runtime } = await start();
    runtime.hooks.advanceTime(4000);

    runtime.hooks.renderAt(2500);

    expect(runtime.clock.tick).toBe(150);
    expect(metrics.restoreCalls).toHaveLength(1);
  });

  it('replays recorded input between a restored keyframe and the target time', async () => {
    const { runtime } = await start();
    runtime.hooks.advanceTime(1000);
    runtime.hooks.inject({ playerIndex: 0, tick: 61, source: 'network', actions: { go: true } });
    runtime.hooks.advanceTime(1000);

    runtime.hooks.renderAt(1500);

    expect(runtime.clock.tick).toBe(90);
    expect(runtime.instance.serialize().data.counter).toBe(1);
  });

  it('does not double-count a partial step when rendering the same absolute time', async () => {
    const { runtime } = await start();
    runtime.hooks.advanceTime(16);

    runtime.hooks.renderAt(16);

    expect(runtime.clock.tick).toBe(0);
  });

  it('rewinds while paused and preserves the paused state', async () => {
    const { runtime } = await start();
    const pausedDuringRender: boolean[] = [];
    runtime.onFrame(() => pausedDuringRender.push(runtime.clock.paused));
    runtime.hooks.advanceTime(4000);
    runtime.clock.pause();

    runtime.hooks.renderAt(2500);

    expect(runtime.clock.tick).toBe(150);
    expect(runtime.clock.paused).toBe(true);
    expect(pausedDuringRender.at(-1)).toBe(true);
  });

  it('rejects rewinds older than the retained history window', async () => {
    const { runtime } = await start();
    runtime.hooks.advanceTime(31_000);

    expect(() => runtime.hooks.renderAt(0)).toThrow('retained rewind history');
  });

  it('renders serialized data and caps oversized output', async () => {
    const { runtime } = await start();
    expect(runtime.hooks.renderGameToText().state).toEqual(runtime.instance.serialize().data);

    const save = runtime.instance.serialize();
    save.data.padding = '😀'.repeat(20_000);
    runtime.instance.restore(save);
    const text = runtime.hooks.renderGameToText() as ReturnType<GmTestHooks['renderGameToText']> & {
      truncated?: boolean;
    };

    expect(text.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(text)).byteLength).toBeLessThanOrEqual(65_536);
  });

  it('restores serialized state through the browser hook surface', async () => {
    const { runtime } = await start();
    const save = runtime.instance.serialize();
    runtime.hooks.inject({ playerIndex: 0, tick: 0, source: 'network', actions: { go: true } });
    runtime.hooks.advanceTime(17);

    runtime.hooks.restore(save);

    expect(runtime.instance.serialize()).toEqual(save);
  });

  it('refuses to rewind across a restore instead of replaying the overwritten history', async () => {
    const { runtime } = await start();
    const save = runtime.instance.serialize();
    runtime.hooks.advanceTime(500);

    runtime.hooks.restore(save);

    expect(() => runtime.hooks.renderAt(100)).toThrow('predates retained rewind history');
    expect(runtime.instance.serialize()).toEqual(save);
  });

  it('is deterministic for equal seeds and injected frames', async () => {
    const first = await start();
    const second = await start();
    first.runtime.hooks.setSeed(42);
    second.runtime.hooks.setSeed(42);

    for (let tick = 0; tick < 600; tick += 1) {
      const frame = { playerIndex: 0, tick, source: 'network' as const, actions: { go: tick % 10 === 0 } };
      first.runtime.hooks.inject(frame);
      second.runtime.hooks.inject(frame);
      first.runtime.hooks.advanceTime(1000 / 60);
      second.runtime.hooks.advanceTime(1000 / 60);
    }

    expect(first.runtime.hooks.renderGameToText()).toEqual(second.runtime.hooks.renderGameToText());
  });

  it('serves probes, hit tests, events, render info, and a rolling bug bundle', async () => {
    const { runtime } = await start();
    expect(runtime.hooks.renderInfo()).toEqual({
      calls: 0,
      triangles: 0,
      frameMs: 0,
      textureBytes: 0,
      backend: 'headless',
      net: {
        mode: 'host',
        epoch: '',
        tick: 0,
        lateStartTicks: 0,
        inputDelayTicks: 0,
        inputGaps: 0,
        lateInputs: 0,
        localResponseMs: 0,
        remoteUpdateMs: 0,
        clockOffsetMs: 0,
        clockResyncs: 0,
        desyncs: 0,
        recoveries: 0,
        hardResyncs: 0,
        desynced: false,
        dropped: 0,
        eventGaps: 0,
        outOfOrderSnapshots: 0,
        stalls: 0,
        oversized: 0,
        eventDelayMs: 0,
        eventDelayP95Ms: 0,
        droppedBytes: 0,
      },
    });
    runtime.setRenderInfoProvider(() => ({ calls: 1, triangles: 2, frameMs: 3, textureBytes: 4, backend: 'test' }));
    runtime.host.events.emit('analytics', { name: 'started' });
    runtime.hooks.inject({ playerIndex: 0, tick: 0, source: 'keyboard', actions: {} });
    runtime.hooks.advanceTime(31_000);

    expect(runtime.hooks.hitTest(0.5, 0.5)).toBe(true);
    expect(runtime.hooks.probes()).toMatchObject({ counter: 0, tick: 1860, paused: false });
    expect(runtime.hooks.events(0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'analytics' })]));
    expect(runtime.hooks.renderInfo()).toMatchObject({ backend: 'test', triangles: 2 });
    expect(runtime.hooks.bundle()).toEqual({
      frames: [],
      keyframes: [
        expect.objectContaining({ tick: 600 }),
        expect.objectContaining({ tick: 1200 }),
        expect.objectContaining({ tick: 1800 }),
      ],
    });
  });
});
