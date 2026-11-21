import { expect, it } from 'vitest';
import { scoreRegisteredScene } from '../src/scene/registered-score.js';
import { warpNearest } from '../src/scene/warp.js';

it('scores covered pixels and refuses transparent warp padding', () => {
  const reference = { width: 2, height: 1, pixels: Buffer.from([255, 0, 0, 0, 0, 0]) };
  const source = { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) };
  const render = warpNearest(source, 2, 1, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const covered = { id: 'covered', bounds: { x: 0, y: 0, w: 1, h: 1 } };
  expect(scoreRegisteredScene(reference, render, [covered])[0]!.ssim).toBe(1);
  expect(() => scoreRegisteredScene(reference, render, [{ id: 'whole', bounds: { x: 0, y: 0, w: 2, h: 1 } }])).toThrow(
    'incomplete registered coverage',
  );
});
