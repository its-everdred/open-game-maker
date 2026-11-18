import type { Envelope } from '@ogm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { boot } from './boot.js';
import { installQa } from './qa.js';
import { createCounterGame } from '../test/fixtures/counter-game.js';

const bridge = vi.hoisted(() => ({
  onMessage: undefined as ((message: Envelope<string, unknown>) => void) | undefined,
}));

vi.mock('@ogm/iframe-bridge', () => ({
  openGameBridge: vi.fn((options: { onMessage: (message: Envelope<string, unknown>) => void }) => {
    bridge.onMessage = options.onMessage;
    return { ready: Promise.resolve(), send: vi.fn(), close: vi.fn(), request: vi.fn() };
  }),
}));

describe('gm.qa.invariants', () => {
  afterEach(() => Reflect.deleteProperty(window, '__gmQa'));

  /* The playtest runs against published builds too, where the test globals are stripped. */
  it('is reachable from a published build once the game boots, and gone after dispose', async () => {
    const fixture = createCounterGame();
    const instanceQa = { invariants: () => [{ name: 'one board', ok: false, detail: '2 boards' }] };
    const module = fixture.module;
    const mount: typeof module.mount = async (host, design, save) =>
      Object.assign(await module.mount(host, design, save), { qa: instanceQa });
    const pending = boot({ ...module, mount }, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!({
      v: 1,
      id: 'host-1',
      t: 'hello',
      payload: { protocol: 1, capabilities: [], mode: 'play', build: 'published', playerIndex: 0 },
    });
    const runtime = await pending;
    expect(window.__gmQa?.invariants()).toEqual([{ name: 'one board', ok: false, detail: '2 boards' }]);
    runtime.dispose();
    expect(window.__gmQa).toBeUndefined();
  });

  it('reports null for a game without checks, so the playtest can say they are missing', () => {
    const remove = installQa({});
    expect(window.__gmQa?.invariants()).toBeNull();
    remove();
  });

  it('turns a throwing check into a failed invariant instead of crashing the playtest', () => {
    const remove = installQa({
      qa: {
        invariants: () => {
          throw new Error('grid undefined');
        },
      },
    });
    expect(window.__gmQa?.invariants()).toEqual([{ name: 'invariants ran', ok: false, detail: 'grid undefined' }]);
    remove();
  });
});
