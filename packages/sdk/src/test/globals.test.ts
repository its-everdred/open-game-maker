import type { GmTestHooks } from '@ogm/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGlobals } from './globals.js';
import { reportImageDraw } from './image-draws.js';

const makeHooks = (): GmTestHooks => ({
  ready: true,
  marks: [['start', 0]],
  advanceTime: vi.fn(),
  renderAt: vi.fn(),
  renderGameToText: vi.fn(() => ({ coords: 'grid', tick: 0, mode: 'play' as const, state: {}, players: [] })),
  renderInfo: vi.fn(() => ({ calls: 0, triangles: 0, frameMs: 0, textureBytes: 0, backend: 'test' })),
  hitTest: vi.fn(() => false),
  setSeed: vi.fn(),
  inject: vi.fn(),
  probes: vi.fn(() => ({})),
  events: vi.fn(() => []),
  seed: vi.fn(() => 1),
});

describe('installGlobals', () => {
  beforeEach(() => {
    for (const key of ['__gm', 'render_game_to_text', 'advanceTime', '__frame', '__ready', '__marks']) {
      Reflect.deleteProperty(window, key);
    }
  });

  it('installs the draft aliases with their historical units', () => {
    const hooks = makeHooks();
    installGlobals(hooks, 'draft');

    window.__gm!.tick(0.5);
    window.__frame!(2.5);

    expect(hooks.advanceTime).toHaveBeenCalledWith(500);
    expect(hooks.renderAt).toHaveBeenCalledWith(2500);
    expect(window.__ready).toBe(true);
    expect(window.__marks).toBe(hooks.marks);
    expect(JSON.parse(window.render_game_to_text!())).toMatchObject({ tick: 0, mode: 'play' });
  });

  it('does not install any published-build debug surface', () => {
    installGlobals(makeHooks(), 'published');

    expect(window.__gm).toBeUndefined();
    expect(window.render_game_to_text).toBeUndefined();
    expect(window.advanceTime).toBeUndefined();
    expect(window.__frame).toBeUndefined();
    expect(window.__ready).toBeUndefined();
    expect(window.__marks).toBeUndefined();
  });

  it('exposes the current UI sprite reports only while the draft hooks are installed', () => {
    const cleanup = installGlobals(makeHooks(), 'draft');
    reportImageDraw({
      id: 'button',
      file: 'button.png',
      source: { width: 90, height: 30 },
      drawn: { width: 30, height: 30 },
    });
    expect(window.__gm?.imageDraws?.()).toMatchObject([{ id: 'button', file: 'button.png' }]);
    cleanup();
    expect(window.__gm).toBeUndefined();
  });
});
