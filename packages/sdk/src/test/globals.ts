import type { GmTestHooks, SaveData } from '@ogm/contracts';

import { imageDraws, imageDrawsReady, resetImageDraws } from './image-draws.js';

import type { BuildKind } from '../core/runtime.js';

export type GlobalHooks = GmTestHooks & {
  tick(seconds: number): void;
  restore?(save: SaveData<unknown>): void;
  imageDraws?: typeof imageDraws;
  imageDrawsReady?: typeof imageDrawsReady;
};

declare global {
  interface Window {
    __frame?: (seconds: number) => void;
    __gm?: GlobalHooks;
    __marks?: [string, number][];
    __ready?: boolean;
    advanceTime?: (ms: number) => void;
    render_game_to_text?: () => string;
  }
}

export function installGlobals(hooks: GmTestHooks, build: BuildKind): () => void {
  if (build === 'published') return () => undefined;

  resetImageDraws();
  const globalHooks = Object.assign(hooks, {
    imageDraws,
    imageDrawsReady,
    tick: (seconds: number) => hooks.advanceTime(seconds * 1000),
  }) as GlobalHooks;
  window.__gm = globalHooks;
  window.render_game_to_text = () => JSON.stringify(hooks.renderGameToText());
  window.advanceTime = (ms) => hooks.advanceTime(ms);
  window.__frame = (seconds) => hooks.renderAt(seconds * 1000);
  window.__marks = hooks.marks;
  Object.defineProperty(window, '__ready', {
    configurable: true,
    get: () => hooks.ready,
  });

  return () => {
    resetImageDraws();
    for (const key of ['__gm', 'render_game_to_text', 'advanceTime', '__frame', '__ready', '__marks']) {
      Reflect.deleteProperty(window, key);
    }
  };
}
