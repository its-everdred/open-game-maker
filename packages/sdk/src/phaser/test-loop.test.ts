import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

import { installSdkRenderLoop } from './test-loop.js';
import type { Runtime } from '../core/runtime.js';

type Draws = { elements?: number; instanced?: number; canvas?: number };

interface FakeRenderer {
  drawCount?: number;
  drawElements?: (...args: unknown[]) => void;
  drawInstancedArrays?: (...args: unknown[]) => void;
}

/**
 * A Phaser stand-in whose step issues the requested draws through the same seams the real renderers use, so the
 * loop's per-frame tally can be observed without a GPU. `canvas` mimics the Canvas renderer's own per-frame
 * `drawCount`, which the real one resets in `preRender` and accumulates per rendered Game Object.
 */
function fakeGame(drawsPerFrame: Draws[], options: { webgl?: boolean } = {}) {
  const webgl = options.webgl ?? true;
  const queue = [...drawsPerFrame];
  const renderer: FakeRenderer = {};
  if (webgl) {
    renderer.drawElements = () => undefined;
    renderer.drawInstancedArrays = () => undefined;
  }
  const game = {
    renderer,
    loop: {
      sleep: () => undefined,
      lastTime: 1,
      step: () => {
        const draws = queue.shift() ?? {};
        for (let i = 0; i < (draws.elements ?? 0); i += 1) renderer.drawElements?.();
        for (let i = 0; i < (draws.instanced ?? 0); i += 1) renderer.drawInstancedArrays?.();
        if (draws.canvas !== undefined) renderer.drawCount = draws.canvas;
      },
    },
  };
  return { game: game as unknown as Phaser.Game, renderer };
}

function fakeRuntime() {
  const frames: ((dt: number) => void)[] = [];
  const runtime = {
    clock: { dt: 1 / 60 },
    onFrame: (listener: (dt: number) => void) => {
      frames.push(listener);
      return () => undefined;
    },
  };
  return { runtime: runtime as unknown as Runtime<unknown, unknown>, frames };
}

describe('installSdkRenderLoop', () => {
  it('reports the draw calls of the frame it just rendered, not a since-boot total', () => {
    const { game } = fakeGame([{ elements: 4 }, { elements: 7 }, { elements: 2 }]);
    const { runtime, frames } = fakeRuntime();
    const loop = installSdkRenderLoop(runtime, game);

    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(4);
    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(7);
    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(2);
  });

  it('counts instanced draws as draw calls too', () => {
    const { game } = fakeGame([{ elements: 2, instanced: 3 }]);
    const { runtime, frames } = fakeRuntime();
    const loop = installSdkRenderLoop(runtime, game);

    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(5);
  });

  it('reads the Canvas renderer per-frame drawCount when there are no WebGL draw seams', () => {
    const { game } = fakeGame([{ canvas: 0 }, { canvas: 18 }], { webgl: false });
    const { runtime, frames } = fakeRuntime();
    const loop = installSdkRenderLoop(runtime, game);

    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(0);
    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(18);
  });

  it('reports no draw calls when the renderer exposes no seam at all', () => {
    const { game } = fakeGame([{ elements: 3 }], { webgl: false });
    const { runtime, frames } = fakeRuntime();
    const loop = installSdkRenderLoop(runtime, game);

    frames[0]!(1 / 60);
    expect(loop.calls()).toBe(0);
  });

  it('advances Phaser by the elapsed presentation time supplied by the runtime', () => {
    const { game } = fakeGame([{}, {}]);
    const step = vi.spyOn(game.loop, 'step');
    const { runtime, frames } = fakeRuntime();
    installSdkRenderLoop(runtime, game);
    frames[0]!(1 / 15);
    frames[0]!(1 / 15);
    expect(step.mock.calls[1]![0]).toBeCloseTo(2000 / 15);
    expect(game.loop.smoothStep).toBe(false);
  });

  it('keeps the frame time of the frame it rendered', () => {
    const { game } = fakeGame([{ elements: 1 }]);
    const { runtime, frames } = fakeRuntime();
    const loop = installSdkRenderLoop(runtime, game);

    frames[0]!(1 / 60);
    expect(loop.frameMs()).toBeCloseTo(1000 / 60);
  });
});
