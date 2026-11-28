import type { Envelope, HostToGame } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { boot } from './boot.js';
import { createMenu } from '../menu/index.js';
import { createCounterGame } from '../test/fixtures/counter-game.js';

const bridge = vi.hoisted(() => ({
  onMessage: undefined as ((message: Envelope<string, unknown>) => void) | undefined,
}));

vi.mock('@ogm/iframe-bridge', () => ({
  openGameBridge: vi.fn((options: { onMessage: (message: Envelope<string, unknown>) => void }) => {
    bridge.onMessage = options.onMessage;
    return {
      ready: Promise.resolve(),
      send: vi.fn(),
      close: vi.fn(),
      request: vi.fn(),
      stats: () => ({ dropped: { tooLarge: 0, rateLimited: 0, invalid: 0 }, sent: 0, received: 0 }),
    };
  }),
}));

let id = 0;
const message = <T extends HostToGame['t']>(t: T, payload: Extract<HostToGame, { t: T }>['payload']) =>
  ({ v: 1, id: `host-${++id}`, t, payload }) as Extract<HostToGame, { t: T }>;

describe('boot menu input', () => {
  it('routes the selected named controls from the bridge to a menu', async () => {
    const fixture = createCounterGame();
    const module = {
      ...fixture.module,
      manifest: {
        ...fixture.module.manifest,
        inputs: {
          actions: {
            move: 'stick' as const,
            go: 'button' as const,
            accept: 'button' as const,
            cancel: 'button' as const,
          },
          controls: {
            menu: {
              layout: 'dpad' as const,
              stick: 'move',
              buttons: [
                { action: 'accept', icon: 'confirm' as const, label: 'Confirm', behavior: 'tap' as const },
                { action: 'cancel', icon: 'back' as const, label: 'Back', behavior: 'tap' as const },
              ],
            },
          },
        },
      },
    };
    const pending = boot(module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(
      message('hello', { protocol: 1, capabilities: [], mode: 'play', build: 'draft', playerIndex: 0 }),
    );
    const runtime = await pending;
    runtime.host.controls?.set({ layout: 'menu' });
    document.body.innerHTML = '<div id="pause"><button>Resume</button></div>';
    const resume = vi.fn();
    const back = vi.fn();
    document.querySelector('button')!.addEventListener('click', resume);
    const menu = createMenu({ root: document.querySelector<HTMLElement>('#pause')!, onBack: back });
    bridge.onMessage!(message('input.frame', { playerIndex: 0, tick: 0, source: 'touch', actions: { accept: true } }));
    bridge.onMessage!(
      message('input.frame', { playerIndex: 0, tick: 1, source: 'touch', actions: { accept: false, cancel: true } }),
    );
    expect(resume).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
    menu.dispose();
    runtime.dispose();
  });

  it("drives an open menu from the host's on-screen controller, but not under the host's pause dialog", async () => {
    const { module } = createCounterGame();
    const pending = boot(module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(
      message('hello', { protocol: 1, capabilities: [], mode: 'play', build: 'draft', playerIndex: 0 }),
    );
    const runtime = await pending;
    document.body.innerHTML = '<div id="pause"><button>Resume</button></div>';
    const resume = vi.fn();
    document.querySelector('button')!.addEventListener('click', resume);
    const menu = createMenu({ root: document.querySelector<HTMLElement>('#pause')! });

    // The counter game's only button action, `go`, is the controller's A.
    const press = (go: boolean) =>
      bridge.onMessage!(message('input.frame', { playerIndex: 0, tick: 0, source: 'touch', actions: { go } }));
    bridge.onMessage!(message('lifecycle.pause', {}));
    press(true);
    press(false);
    expect(resume).not.toHaveBeenCalled();

    // A held through the host's dialog, still held after it closes, is not a new press.
    press(true);
    bridge.onMessage!(message('lifecycle.resume', {}));
    press(true);
    expect(resume).not.toHaveBeenCalled();
    press(false);
    press(true);
    expect(resume).toHaveBeenCalledOnce();
    menu.dispose();
    runtime.dispose();
  });
});
