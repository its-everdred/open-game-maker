import { afterEach, expect, it, vi } from 'vitest';

import { HostBridge } from './bridge.js';
import { createGameFrame } from './frame.js';
import { GamepadPoller } from './gamepad.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** A phone-sized frame whose game declares a stick and three buttons, as Dusk Helm's does. */
function phoneFrame() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
  const container = document.createElement('div');
  document.body.append(container);
  const on = vi.spyOn(HostBridge.prototype, 'on');
  const frame = createGameFrame({
    container,
    gamesOrigin: 'https://games.test',
    appOrigin: 'https://app.test',
    gameId: 'g',
    buildId: 'b',
    build: 'published',
    mode: 'play',
    playerIndex: 0,
    capabilities: [],
    role: () => 'owner',
  });
  const ready = on.mock.calls.find(([type]) => type === 'ready')?.[1] as (payload: unknown) => void;
  on.mockRestore();
  const receive = (frame.bridge as unknown as { receive(message: unknown): void }).receive.bind(frame.bridge);
  let id = 0;
  /* `ready` goes straight to the host's handler: this manifest carries only the inputs under test. */
  const game = (t: string, payload: unknown) =>
    t === 'ready' ? ready(payload) : receive({ v: 1, id: `game-${++id}`, t, payload });
  const layer = frame.iframe.nextElementSibling as HTMLElement;
  const shown = (selector: string) => {
    const control = layer.querySelector<HTMLElement>(selector);
    return !layer.hidden && control !== null && control.style.visibility !== 'hidden';
  };
  return { frame, game, layer, shown };
}

const manifest = {
  inputs: { actions: { move: 'stick', attack: 'button', use: 'button', cast: 'button', block: 'button' } },
};

it('keeps legacy self controls from acquiring a second host overlay', () => {
  const { frame, game, layer } = phoneFrame();
  game('ready', {
    protocol: 1,
    manifest: { inputs: { actions: { move: 'stick' }, touch: 'self' } },
    marks: [],
    firstFrameSignal: true,
  });
  game('load.frame', {});
  expect(layer.hidden).toBe(true);
  vi.spyOn(frame.bridge, 'send').mockReturnValue(true);
  frame.setMode('play');
  expect(layer.hidden).toBe(true);
  frame.dispose();
});

it('keeps the controls off the loading screen until the game draws its first frame', () => {
  const { frame, game, layer } = phoneFrame();
  game('ready', { protocol: 1, manifest, marks: [], firstFrameSignal: true });
  expect(layer.querySelector('[data-stick="move"]')).not.toBeNull();
  expect(layer.hidden).toBe(true);
  game('load.frame', {});
  expect(layer.hidden).toBe(false);
  frame.dispose();
});

it('also waits for the observed first frame of a build that does not signal its own', () => {
  const { frame, game, layer } = phoneFrame();
  game('ready', { protocol: 1, manifest, marks: [] });
  expect(layer.hidden).toBe(true);
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'ogm.frame.ready.v2' },
      origin: 'https://games.test',
      source: frame.iframe.contentWindow,
    }),
  );
  expect(layer.hidden).toBe(false);
  frame.dispose();
});

it('shows no controls on a title the game marks none, and every control once it plays', () => {
  const { frame, game, layer, shown } = phoneFrame();
  /* A game sets its title's layout while mounting, before it reports ready. */
  game('host.controls', { layout: 'none' });
  game('ready', { protocol: 1, manifest, marks: [], firstFrameSignal: true });
  game('load.frame', {});
  expect(layer.hidden).toBe(true);
  game('host.controls', { layout: 'gameplay' });
  for (const control of ['[data-stick="move"]', '[data-action="attack"]', '[data-action="cast"]']) {
    expect(shown(control)).toBe(true);
  }
  frame.dispose();
});

it('keeps only what a menu reads under menu: the stick, A (first button) and B (third)', () => {
  const { frame, game, shown } = phoneFrame();
  game('ready', { protocol: 1, manifest, marks: [], firstFrameSignal: true });
  game('load.frame', {});
  game('host.controls', { layout: 'menu' });
  expect(shown('[data-stick="move"]')).toBe(true);
  expect(shown('[data-action="attack"]')).toBe(true);
  expect(shown('[data-action="use"]')).toBe(false);
  expect(shown('[data-action="cast"]')).toBe(true);
  expect(shown('[data-action="block"]')).toBe(false);
  frame.dispose();
});

it('applies a menu layout the game chose before it was ready once the controls are drawn', () => {
  const { frame, game, shown } = phoneFrame();
  game('host.controls', { layout: 'menu' });
  game('ready', { protocol: 1, manifest, marks: [], firstFrameSignal: true });
  game('load.frame', {});
  expect(shown('[data-action="attack"]')).toBe(true);
  expect(shown('[data-action="use"]')).toBe(false);
  game('host.controls', { layout: 'gameplay' });
  expect(shown('[data-action="use"]')).toBe(true);
  frame.dispose();
});

it('shows the controls when the observed first frame arrived before the game was ready', () => {
  const { frame, game, layer } = phoneFrame();
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'ogm.frame.ready.v2' },
      origin: 'https://games.test',
      source: frame.iframe.contentWindow,
    }),
  );
  game('ready', { protocol: 1, manifest, marks: [] });
  expect(layer.hidden).toBe(false);
  frame.dispose();
});

it('shows every control for a game that never chooses, as before', () => {
  const { frame, game, shown } = phoneFrame();
  game('ready', { protocol: 1, manifest, marks: [], firstFrameSignal: true });
  game('load.frame', {});
  for (const action of Object.keys(manifest.inputs.actions)) {
    expect(shown(action === 'move' ? '[data-stick="move"]' : `[data-action="${action}"]`)).toBe(true);
  }
  frame.dispose();
});

it('switches named control sets and releases a held action when the context changes', () => {
  const mappings = vi.spyOn(GamepadPoller.prototype, 'setMapping');
  const { frame, game, layer } = phoneFrame();
  const send = vi.spyOn(frame.bridge, 'send');
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { move: 'stick', attack: 'button', talk: 'button', block: 'button' },
        controls: {
          gameplay: {
            layout: 'stick',
            stick: 'move',
            buttons: [
              { action: 'attack', icon: 'attack', label: 'Attack', behavior: 'hold' },
              { action: 'block', icon: 'block', label: 'Block', behavior: 'hold' },
            ],
          },
          conversation: {
            layout: 'stick',
            stick: 'move',
            buttons: [{ action: 'talk', icon: 'use', label: 'Talk', behavior: 'tap' }],
          },
        },
      },
    },
    marks: [],
    firstFrameSignal: true,
  });
  game('load.frame', {});
  const attack = layer.querySelector<HTMLButtonElement>('[data-action="attack"]')!;
  expect(attack.getAttribute('aria-label')).toBe('Attack');
  attack.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  game('host.controls', { layout: 'conversation' });
  expect(send).toHaveBeenCalledWith(
    'input.frame',
    expect.objectContaining({ cancelPending: true, actions: expect.objectContaining({ attack: false }) }),
  );
  expect(layer.querySelector('[data-action="attack"]')).toBeNull();
  expect(layer.querySelector('[data-action="talk"] [data-icon="use"]')).not.toBeNull();
  expect(mappings).toHaveBeenLastCalledWith({ talk: 'a' }, { move: 'stick', talk: 'button' }, true);
  mappings.mockRestore();
  frame.dispose();
});

it('maps a named menu confirm and back to physical A and B', () => {
  const mappings = vi.spyOn(GamepadPoller.prototype, 'setMapping');
  const { frame, game } = phoneFrame();
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { move: 'stick', confirm: 'button', back: 'button' },
        controls: {
          menu: {
            layout: 'dpad',
            stick: 'move',
            buttons: [
              { action: 'confirm', icon: 'confirm', label: 'Confirm', behavior: 'tap' },
              { action: 'back', icon: 'back', label: 'Back', behavior: 'tap' },
            ],
          },
        },
      },
    },
    marks: [],
  });
  game('host.controls', { layout: 'menu' });
  expect(mappings).toHaveBeenLastCalledWith(
    { confirm: 'a', back: 'b' },
    { move: 'stick', confirm: 'button', back: 'button' },
    true,
  );
  mappings.mockRestore();
  frame.dispose();
});

it('does not assign the same gamepad button to confirm and another action', () => {
  let pressed = 0;
  const previous = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => [
      {
        id: 'test-pad',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 16 }, (_, index) => ({
          pressed: index === pressed,
          touched: index === pressed,
          value: Number(index === pressed),
        })),
      },
    ],
  });
  const mappings = vi.spyOn(GamepadPoller.prototype, 'setMapping');
  const { frame, game } = phoneFrame();
  const send = vi.spyOn(frame.bridge, 'send');
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { attack: 'button', interact: 'button' },
        controls: {
          gameplay: {
            layout: 'tap',
            buttons: [
              { action: 'attack', icon: 'attack', label: 'Attack', behavior: 'tap' },
              { action: 'interact', icon: 'confirm', label: 'Interact', behavior: 'tap' },
            ],
          },
        },
      },
    },
    marks: [],
  });
  expect(mappings).toHaveBeenLastCalledWith(
    { attack: 'x', interact: 'a' },
    { attack: 'button', interact: 'button' },
    false,
  );
  frame.gamepads.poll(100);
  expect(send).toHaveBeenLastCalledWith(
    'input.frame',
    expect.objectContaining({ actions: { attack: false, interact: true } }),
  );
  pressed = 2;
  frame.gamepads.poll(200);
  expect(send).toHaveBeenLastCalledWith(
    'input.frame',
    expect.objectContaining({ actions: { attack: true, interact: false } }),
  );
  mappings.mockRestore();
  frame.dispose();
  if (previous) Object.defineProperty(navigator, 'getGamepads', previous);
  else Reflect.deleteProperty(navigator, 'getGamepads');
});

it('uses a declared D-pad to send a stick action and clears it on release', () => {
  const { frame, game, layer } = phoneFrame();
  const send = vi.spyOn(frame.bridge, 'send');
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { move: 'stick' },
        controls: { gameplay: { layout: 'dpad', stick: 'move', buttons: [] } },
      },
    },
    marks: [],
    firstFrameSignal: true,
  });
  game('load.frame', {});
  const right = layer.querySelector<HTMLButtonElement>('[aria-label="Move right"]')!;
  expect(right).not.toBeNull();
  const pointer = (type: string) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    right.dispatchEvent(event);
  };
  pointer('pointerdown');
  expect(send).toHaveBeenLastCalledWith('input.frame', expect.objectContaining({ actions: { move: { x: 1, y: 0 } } }));
  pointer('pointerup');
  expect(send).toHaveBeenLastCalledWith('input.frame', expect.objectContaining({ actions: { move: { x: 0, y: 0 } } }));
  frame.dispose();
});

it('retargets a captured D-pad pointer when it slides to another direction', () => {
  const { frame, game, layer } = phoneFrame();
  const send = vi.spyOn(frame.bridge, 'send');
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { move: 'stick' },
        controls: {
          gameplay: { layout: 'dpad', stick: 'move', buttons: [] },
        },
      },
    },
    marks: [],
    firstFrameSignal: true,
  });
  game('load.frame', {});
  const right = layer.querySelector<HTMLButtonElement>('[data-direction="right"]')!;
  const down = layer.querySelector<HTMLButtonElement>('[data-direction="down"]')!;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => down });
  for (const type of ['pointerdown', 'pointermove']) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    right.dispatchEvent(event);
  }
  expect(send).toHaveBeenLastCalledWith('input.frame', expect.objectContaining({ actions: { move: { x: 0, y: 1 } } }));
  Reflect.deleteProperty(document, 'elementFromPoint');
  frame.dispose();
});

it('forgets held D-pad pointers when another input hides the overlay', () => {
  vi.useFakeTimers();
  const { frame, game, layer } = phoneFrame();
  const send = vi.spyOn(frame.bridge, 'send');
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { move: 'stick' },
        controls: {
          gameplay: { layout: 'dpad', stick: 'move', buttons: [] },
        },
      },
    },
    marks: [],
    firstFrameSignal: true,
  });
  game('load.frame', {});
  const press = (direction: string, pointerId: number) => {
    const event = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    layer.querySelector(`[data-direction="${direction}"]`)!.dispatchEvent(event);
  };
  press('right', 1);
  frame.overlay.noteKeyboardInput();
  vi.advanceTimersByTime(2001);
  press('left', 2);
  expect(send).toHaveBeenLastCalledWith('input.frame', expect.objectContaining({ actions: { move: { x: -1, y: 0 } } }));
  frame.dispose();
  vi.useRealTimers();
});

it('does not treat an inherited object property as a declared control set', () => {
  const { frame, game, layer } = phoneFrame();
  game('ready', {
    protocol: 1,
    manifest: {
      inputs: {
        actions: { attack: 'button' },
        controls: {
          gameplay: {
            layout: 'tap',
            buttons: [{ action: 'attack', icon: 'attack', label: 'Attack', behavior: 'tap' }],
          },
        },
      },
    },
    marks: [],
    firstFrameSignal: true,
  });
  game('load.frame', {});
  expect(() => game('host.controls', { layout: 'constructor' })).not.toThrow();
  expect(layer.querySelector('[data-action]')).toBeNull();
  frame.dispose();
});
