import type Phaser from 'phaser';

import type { Runtime } from '../core/runtime.js';

export interface RenderLoop {
  renderOnce(): void;
  /**
   * Draw calls the renderer issued for the most recently rendered frame — a per-frame figure, never the run's
   * cumulative render count (#272).
   */
  calls(): number;
  frameMs(): number;
}

/** Phaser 4's WebGL renderer routes every draw through these two methods. */
const DRAW_METHODS = ['drawElements', 'drawInstancedArrays'] as const;

type DrawMethod = (typeof DRAW_METHODS)[number];

type DrawableRenderer = Partial<Record<DrawMethod, (...args: unknown[]) => unknown>> & { drawCount?: unknown };

interface FrameDraws {
  /** Clears the tally so the frame about to render starts at zero. */
  begin(): void;
  /** Draw calls the frame just rendered issued. */
  end(): number;
}

/**
 * Reads one frame's draw calls from the Phaser renderer. Wrapping the WebGL draw methods counts the draws the frame
 * issues; the Canvas renderer keeps its own per-frame tally in `drawCount` (reset in `preRender`, accumulated as it
 * draws Game Objects), which needs no wrapping. A renderer with neither seam draws nothing measurable and reports 0.
 *
 * The tally is per frame, so the figure stays flat as a run captures more frames — the cumulative-since-boot render
 * count made every long run look over budget (#272).
 */
function frameDraws(renderer: DrawableRenderer): FrameDraws {
  let draws = 0;
  let wraps = 0;
  for (const method of DRAW_METHODS) {
    const original = renderer[method];
    if (typeof original !== 'function') continue;
    wraps += 1;
    renderer[method] = function (this: unknown, ...args: unknown[]) {
      draws += 1;
      return original.apply(this, args);
    };
  }
  if (wraps > 0) {
    return {
      begin: () => {
        draws = 0;
      },
      end: () => draws,
    };
  }
  return {
    begin: () => undefined,
    end: () => (typeof renderer.drawCount === 'number' ? renderer.drawCount : 0),
  };
}

/** Phaser remains a view: the SDK clock decides when its update/render pass runs. */
export function installSdkRenderLoop<D, S>(runtime: Runtime<D, S>, game: Phaser.Game): RenderLoop {
  let frameDrawCalls = 0;
  let elapsedMs = 0;
  let lastFrameMs = 0;

  const draws = frameDraws((game.renderer ?? {}) as DrawableRenderer);

  game.loop.sleep();
  game.loop.lastTime = 0;

  const renderOnce = (dt = runtime.clock.dt) => {
    lastFrameMs = dt * 1000;
    elapsedMs += lastFrameMs;
    draws.begin();
    game.loop.step(elapsedMs);
    frameDrawCalls = draws.end();
  };

  runtime.onFrame(renderOnce);
  return {
    renderOnce,
    calls: () => frameDrawCalls,
    frameMs: () => lastFrameMs,
  };
}
