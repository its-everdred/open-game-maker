import { describe, expect, it } from 'vitest';

import { orthoCamera, phaserCamera, threeCamera } from './camera.js';

/** Clip-space x, y of an effect-space point through a column-major projection (the view is identity). */
function clip(projection: Float32Array, x: number, y: number) {
  return [projection[0]! * x + projection[12]!, projection[5]! * y + projection[13]!].map(
    (v) => Math.round(v * 1e6) / 1e6 + 0,
  );
}

describe('vfx cameras', () => {
  it('maps the visible world rectangle to the whole canvas, y down', () => {
    const camera = orthoCamera({ x: 100, y: 50, width: 640, height: 360 });
    expect(camera.yDown).toBe(true);
    // Play positions are world pixels with y negated, so the top-left corner of the view lands top-left on screen.
    expect(clip(camera.projection, 100, -50)).toEqual([-1, 1]);
    expect(clip(camera.projection, 740, -410)).toEqual([1, -1]);
    expect(clip(camera.projection, 420, -230)).toEqual([0, 0]);
  });

  it('follows a Phaser camera through its world view (scroll and zoom)', () => {
    const zoomed = phaserCamera({ worldView: { x: 200, y: 100, width: 320, height: 180 } });
    // At 2x zoom a world pixel covers twice the clip span.
    expect(zoomed.projection[0]).toBeCloseTo(2 / 320);
    expect(clip(zoomed.projection, 360, -190)).toEqual([0, 0]);
  });

  it('shares a three.js camera without flipping y', () => {
    const projection = Array.from({ length: 16 }, (_, i) => i + 1);
    const view = Array.from({ length: 16 }, (_, i) => 16 - i);
    const camera = threeCamera({ projectionMatrix: { elements: projection }, matrixWorldInverse: { elements: view } });
    expect(Array.from(camera.projection)).toEqual(projection);
    expect(Array.from(camera.view)).toEqual(view);
    expect(camera.yDown).toBe(false);
  });
});
