import { afterEach, expect, it, vi } from 'vitest';

import { HostBridge } from './bridge.js';
import { createGameFrame } from './frame.js';

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

it('advertises the host Back capability to the game', () => {
  const { frame } = phoneFrame();
  const send = vi.spyOn(frame.iframe.contentWindow!, 'postMessage');
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://games.test',
      source: frame.iframe.contentWindow,
      data: JSON.stringify({ v: 1, id: 'hello', t: 'hello', payload: { protocol: 1 } }),
    }),
  );
  const hello = JSON.parse(send.mock.calls[0]![0] as string);
  expect(hello.payload.capabilities).toContain('host.back');
  frame.dispose();
});
