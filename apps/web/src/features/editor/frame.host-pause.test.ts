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
  const tell = (visible: boolean) => listeners.get('host.pause.visible')?.({ visible } as never);
  return { controller, states, stops, tell };
}

it('reports the game asking to hide and show the host Pause control', () => {
  const { controller, states, tell } = mount();
  expect(controller.state().hostPauseVisible).toBeUndefined();

  tell(false);
  expect(controller.state().hostPauseVisible).toBe(false);
  expect(states.at(-1)?.hostPauseVisible).toBe(false);

  tell(true);
  expect(controller.state().hostPauseVisible).toBe(true);
  expect(states.at(-1)?.hostPauseVisible).toBe(true);
});

it('starts a reloaded game with the control visible and stops listening on exit', () => {
  const first = mount();
  first.tell(false);
  first.controller.dispose();
  expect(first.stops.get('host.pause.visible')).toHaveBeenCalledOnce();

  const reloaded = mount();
  expect(reloaded.controller.state().hostPauseVisible).toBeUndefined();
});
