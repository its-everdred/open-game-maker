import { afterEach, expect, it, vi } from 'vitest';

import type { GameFrameOptions } from '@gm/host';
import type { DesignDoc, GameManifest } from '@ogm/contracts/browser';

import { hidesHostPause, mountGameFrame, type GameFrameState } from './frame';

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
  const tellBack = (enabled: boolean, label?: string) => listeners.get('host.back')?.({ enabled, label } as never);
  return { controller, states, stops, tell, tellBack, frame };
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

it('stops listening when the game exits, so a late message cannot hide the control', () => {
  const { controller, states, stops, tell } = mount();
  controller.dispose();
  expect(stops.get('host.pause.visible')).toHaveBeenCalledOnce();
  const published = states.length;
  tell(false);
  expect(states).toHaveLength(published);
  expect(controller.state().hostPauseVisible).toBeUndefined();
});

it('hides the control only in play with a live bridge, never stranding a player on a failed or loading game', () => {
  expect(hidesHostPause('play', { bridgeState: 'ready', hostPauseVisible: false })).toBe(true);
  expect(hidesHostPause('play', { bridgeState: 'ready', hostPauseVisible: true })).toBe(false);
  expect(hidesHostPause('play', { bridgeState: 'ready', hostPauseVisible: false, back: { enabled: true } })).toBe(
    false,
  );
  expect(hidesHostPause('play', { bridgeState: 'ready' })).toBe(false);
  expect(hidesHostPause('play', { bridgeState: 'error', hostPauseVisible: false })).toBe(false);
  expect(hidesHostPause('play', { bridgeState: 'connecting', hostPauseVisible: false })).toBe(false);
  expect(hidesHostPause('edit', { bridgeState: 'ready', hostPauseVisible: false })).toBe(false);
});

it('relays Back availability and sends the player action to the game', () => {
  const { controller, states, stops, tellBack, frame } = mount();
  expect(controller.state().back).toBeUndefined();
  tellBack(true, 'Choose mode');
  expect(states.at(-1)?.back).toEqual({ enabled: true, label: 'Choose mode' });
  controller.back?.();
  expect(frame.send).toHaveBeenCalledWith('navigation.back', {});
  tellBack(false);
  expect(controller.state().back?.enabled).toBe(false);
  controller.dispose();
  expect(stops.get('host.back')).toHaveBeenCalledOnce();
  tellBack(true);
  expect(controller.state().back?.enabled).toBe(false);
});
