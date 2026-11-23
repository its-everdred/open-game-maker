import type { Envelope, HostToGame } from '@ogm/contracts';
import { gameToHostSchema } from '@ogm/contracts/bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boot } from './boot.js';
import { scenarioSeed } from './scenarios.js';
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

const hello = {
  v: 1,
  id: 'host-1',
  t: 'hello',
  payload: { protocol: 1, capabilities: [], mode: 'play', build: 'draft', playerIndex: 0 },
} as Extract<HostToGame, { t: 'hello' }>;

/* Boot the counter game at `search`, with a `wave-3` scenario that starts the counter at its seed. */
async function bootAt(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  const { module } = createCounterGame();
  const starts: { name: string; seed: number }[] = [];
  module.scenarios = {
    'wave-3': (start) => {
      starts.push(start);
      return { saveSchemaVersion: 1, data: { counter: start.seed, entities: {}, players: [] } };
    },
  };
  const pending = boot(module, { hostOrigin: 'https://app.test', headless: true });
  await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
  bridge.onMessage!(hello);
  const runtime = await pending;
  const ready = bridge.send.mock.calls.map(([envelope]) => envelope as Envelope<string, { manifest: object }>);
  return { runtime, starts, manifest: ready.find((envelope) => envelope.t === 'ready')!.payload.manifest };
}

describe('boot scenarios', () => {
  beforeEach(() => {
    bridge.send.mockReset();
    bridge.onMessage = undefined;
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('mounts straight into the named scenario with the same seed every time', async () => {
    const first = await bootAt('?scenario=wave-3');
    expect(first.starts).toEqual([{ name: 'wave-3', seed: scenarioSeed('wave-3') }]);
    expect(first.runtime.instance.serialize().data.counter).toBe(scenarioSeed('wave-3'));
    first.runtime.dispose();

    const linked = await bootAt('?scenario=wave-3&seed=42');
    expect(linked.runtime.instance.serialize().data.counter).toBe(42);
    linked.runtime.dispose();
  });

  it('keeps a scenario run out of the real save', async () => {
    const { runtime, manifest } = await bootAt('?scenario=wave-3');
    expect(manifest).toMatchObject({ saves: false, scenarios: ['wave-3'] });
    runtime.host.events.emit('checkpoint', { reason: 'test' });
    expect(bridge.send).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'save.write' }));
    runtime.dispose();
  });

  it('boots the game normally and still lists its scenarios without one', async () => {
    const { runtime, starts, manifest } = await bootAt('?scenario=not-declared');
    expect(starts).toEqual([]);
    expect(runtime.instance.serialize().data.counter).toBe(0);
    expect(manifest).toMatchObject({ saves: true, scenarios: ['wave-3'] });
    runtime.host.events.emit('checkpoint', { reason: 'test' });
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ t: 'save.write' }));
    runtime.dispose();
  });
});

/* A key the host's manifest schema rejects would fail the whole ready message, and the game would never connect. */
describe('declared scenario names', () => {
  it('lists only names the host accepts and still connects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/');
    const { module } = createCounterGame();
    const start = () => ({ saveSchemaVersion: 1, data: { counter: 0, entities: {}, players: [] } });
    module.scenarios = { 'wave-3': start, bossFight: start };
    bridge.send.mockReset();
    const pending = boot(module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(hello);
    const runtime = await pending;
    const ready = bridge.send.mock.calls
      .map(([envelope]) => envelope as Envelope<string, unknown>)
      .find((envelope) => envelope.t === 'ready')!;
    expect(gameToHostSchema.safeParse(ready).success).toBe(true);
    expect(ready.payload).toMatchObject({ manifest: { scenarios: ['wave-3'] } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('bossFight'));
    error.mockRestore();
    runtime.dispose();
  });
});
