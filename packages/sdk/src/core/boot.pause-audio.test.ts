import type { Envelope, HostToGame } from '@ogm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { boot } from './boot.js';
import { createAudio } from '../audio/index.js';
import { FakeAudioContext, contextConstructor } from '../audio/test/fake-audio.js';
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

let id = 0;
const message = <T extends HostToGame['t']>(t: T, payload: Extract<HostToGame, { t: T }>['payload']) =>
  ({ v: 1, id: `host-${++id}`, t, payload }) as Extract<HostToGame, { t: T }>;

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('paused game audio (#874)', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
  });

  it('keeps the sound off when the page returns until the player resumes', async () => {
    const { module } = createCounterGame();
    const pending = boot(module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(
      message('hello', { protocol: 1, capabilities: [], mode: 'play', build: 'draft', playerIndex: 0 }),
    );
    const runtime = await pending;
    const context = new FakeAudioContext();
    context.state = 'running';
    const audio = createAudio({ rng: () => 0.5, AudioContextCtor: contextConstructor(context) });

    // The shell pauses the game as the player switches apps, then the page hides and shows again.
    bridge.onMessage!(message('lifecycle.pause', {}));
    await vi.waitFor(() => expect(context.suspendCalls).toBe(1));
    setHidden(true);
    setHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.resumeCalls).toBe(0);
    expect(context.state).toBe('suspended');
    expect(runtime.clock.paused).toBe(true);
    // A tap in the game while the menu is up must not bring the sound back either.
    await audio.unlock();
    expect(context.resumeCalls).toBe(0);
    expect(audio.status()).toBe('on');

    bridge.onMessage!(message('lifecycle.resume', {}));
    await vi.waitFor(() => expect(context.resumeCalls).toBe(1));
    expect(runtime.clock.paused).toBe(false);

    audio.dispose();
    runtime.dispose();
  });

  it('brings the sound back on return when the game was resumed while hidden', async () => {
    const context = new FakeAudioContext();
    context.state = 'running';
    const audio = createAudio({ rng: () => 0.5, AudioContextCtor: contextConstructor(context) });
    window.dispatchEvent(new CustomEvent('gm-pause', { detail: { paused: true } }));
    await vi.waitFor(() => expect(context.suspendCalls).toBe(1));
    setHidden(true);
    window.dispatchEvent(new CustomEvent('gm-pause', { detail: { paused: false } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.resumeCalls).toBe(0);
    setHidden(false);
    await vi.waitFor(() => expect(context.resumeCalls).toBe(1));
    audio.dispose();
  });
});
