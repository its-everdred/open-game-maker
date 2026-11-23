import type { Envelope, HostToGame } from '@ogm/contracts';
import { gameToHostSchema } from '@ogm/contracts/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { boot } from './boot.js';
import { linkHd2d, type Hd2dState } from './hd2d-link.js';
import { createCounterGame } from '../test/fixtures/counter-game.js';

const bridge = vi.hoisted(() => ({
  onMessage: undefined as ((message: Envelope<string, unknown>) => void) | undefined,
  send: vi.fn(),
}));

vi.mock('@ogm/iframe-bridge', () => ({
  openGameBridge: vi.fn((options: { onMessage: (message: Envelope<string, unknown>) => void }) => {
    bridge.onMessage = options.onMessage;
    return { ready: Promise.resolve(), send: bridge.send, close: vi.fn(), request: vi.fn() };
  }),
}));

let id = 0;
const message = <T extends HostToGame['t']>(t: T, payload: Extract<HostToGame, { t: T }>['payload']) =>
  ({ v: 1, id: `host-${++id}`, t, payload }) as Extract<HostToGame, { t: T }>;

async function start() {
  const pending = boot(createCounterGame().module, { hostOrigin: 'https://app.test', headless: true });
  await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
  bridge.onMessage!(message('hello', { protocol: 1, capabilities: [], mode: 'edit', build: 'draft', playerIndex: 0 }));
  return pending;
}

const sent = (t: string) =>
  bridge.send.mock.calls.map(([envelope]) => envelope as Envelope<string, unknown>).filter((env) => env.t === t);
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** A stand-in for `createHd2d`'s link: it keeps whatever document the editor applies. */
function fakeHd2d(initial: Hd2dState) {
  let state = initial;
  const link = linkHd2d({
    state: () => state,
    apply(doc, weather) {
      if (doc === 'bad') throw new Error('invalid HD-2D scene');
      state = { ...state, doc, ...(weather ? { weather } : {}) };
      link.changed();
    },
  });
  return link;
}

describe('boot HD-2D link', () => {
  beforeEach(() => {
    id = 0;
    bridge.send.mockReset();
    bridge.onMessage = undefined;
  });

  // The editor seeds its controls from what the scene really renders, so a game created before ready still reports.
  it('reports the running scene, then every edit back to the editor', async () => {
    const hd2d = fakeHd2d({ doc: { version: 1 }, biome: 'forest', weather: 'clear' });
    const runtime = await start();
    await flush();
    expect(sent('hd2d.scene').map((env) => env.payload)).toEqual([
      { doc: { version: 1 }, biome: 'forest', weather: 'clear' },
    ]);
    expect(gameToHostSchema.safeParse(sent('hd2d.scene')[0]).success).toBe(true);

    bridge.onMessage!(message('hd2d.apply', { doc: { version: 1, edited: true }, weather: 'rain' }));
    await flush();
    expect(sent('hd2d.scene').at(-1)!.payload).toEqual({
      doc: { version: 1, edited: true },
      biome: 'forest',
      weather: 'rain',
    });

    hd2d.unlink();
    await flush();
    expect(sent('hd2d.scene').at(-1)!.payload).toEqual({ doc: null });
    runtime.dispose();
  });

  // A drag sends many edits between frames; the bridge caps messages per second.
  it('sends one report for several changes in the same turn', async () => {
    const hd2d = fakeHd2d({ doc: { version: 1 } });
    const runtime = await start();
    await flush();
    bridge.send.mockClear();
    hd2d.changed();
    hd2d.changed();
    hd2d.changed();
    await flush();
    expect(sent('hd2d.scene')).toHaveLength(1);
    hd2d.unlink();
    runtime.dispose();
  });

  it('answers a bad document or a scene without HD-2D with an error, and keeps running', async () => {
    const hd2d = fakeHd2d({ doc: { version: 1 } });
    const runtime = await start();
    bridge.onMessage!(message('hd2d.apply', { doc: 'bad' }));
    expect(sent('error').at(-1)).toMatchObject({ payload: { code: 'apply_failed' }, replyTo: `host-${id}` });
    hd2d.unlink();
    bridge.onMessage!(message('hd2d.apply', { doc: { version: 1 } }));
    expect(sent('error').at(-1)).toMatchObject({ payload: { code: 'unsupported' }, replyTo: `host-${id}` });
    runtime.dispose();
  });
});
