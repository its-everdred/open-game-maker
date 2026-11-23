import { afterEach, expect, it, vi } from 'vitest';

import type { GameFrameOptions } from '@gm/host';
import type { DesignDoc, GameManifest } from '@ogm/contracts/browser';

import { mountGameFrame, type GameFrameState } from './frame';

afterEach(() => document.body.replaceChildren());

function mount() {
  const listeners = new Map<string, (payload: never) => void>();
  const stops = new Map<string, () => void>();
  const frame = {
    bridge: { dropped: 0 },
    on: vi.fn((type: string, callback: (payload: never) => void) => {
      listeners.set(type, callback);
      const stop = vi.fn();
      stops.set(type, stop);
      return stop;
    }),
    setMode: vi.fn(),
    setSettings: vi.fn(),
    send: vi.fn(),
    dispose: vi.fn(),
  };
  const states: GameFrameState[] = [];
  let options: GameFrameOptions | undefined;
  const controller = mountGameFrame({
    container: document.createElement('div'),
    gamesOrigin: 'http://127.0.0.1:10001',
    gameId: 'game',
    buildId: 'build',
    mode: 'play',
    design: { rev: 0, doc: {} as DesignDoc },
    create: (value) => {
      options = value;
      return frame;
    },
    onState: (state) => states.push(state),
  });
  options?.onReady?.({ id: 'blobs', title: 'Blobs', inputs: { actions: {} } } as GameManifest, []);
  const report = (payload: object) => listeners.get('hd2d.scene')?.(payload as never);
  return { controller, frame, states, stops, report };
}

// The lighting panel seeds itself from what the game really renders, so the report has to reach the page's state.
it('publishes the HD-2D the game reports and sends edits back to it', () => {
  const { controller, frame, states, report } = mount();
  expect(controller.state().hd2d).toBeUndefined();

  report({ doc: { version: 1 }, biome: 'forest', weather: 'clear' });
  expect(states.at(-1)?.hd2d).toEqual({ doc: { version: 1 }, biome: 'forest', weather: 'clear' });

  controller.applyHd2d!({ version: 1, edited: true }, 'rain');
  controller.applyHd2d!({ version: 1 });
  expect(frame.send.mock.calls.filter(([type]) => type === 'hd2d.apply')).toEqual([
    ['hd2d.apply', { doc: { version: 1, edited: true }, weather: 'rain' }],
    ['hd2d.apply', { doc: { version: 1 } }],
  ]);
});

it('stops listening when the game exits', () => {
  const { controller, states, stops, report } = mount();
  controller.dispose();
  expect(stops.get('hd2d.scene')).toHaveBeenCalledOnce();
  const published = states.length;
  report({ doc: null });
  expect(states).toHaveLength(published);
});
