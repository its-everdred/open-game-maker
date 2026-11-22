import { expect, it } from 'vitest';
import { scoreSceneRegions } from '../src/scene/region-score.js';

it('scores registered regions independently', () => {
  const reference = { width: 2, height: 1, pixels: Buffer.from([0, 0, 0, 255, 255, 255]) };
  const render = { width: 2, height: 1, pixels: Buffer.from([0, 0, 0, 0, 0, 0]) };
  const scores = scoreSceneRegions(reference, render, [
    { id: 'same', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'changed', bounds: { x: 1, y: 0, w: 1, h: 1 } },
  ]);
  expect(scores[0]!.ssim).toBe(1);
  expect(scores[1]!.ssim).toBeLessThan(0.01);
  expect(scores[1]!.colourHistogramDistance).toBe(1);
  const whole = scoreSceneRegions(reference, render, [{ id: 'whole', bounds: { x: 0, y: 0, w: 2, h: 1 } }]);
  expect(whole[0]!.referenceEdgeDensity).toBe(1);
  expect(whole[0]!.renderEdgeDensity).toBe(0);
});

it('rejects mismatched images, duplicate names and out-of-bounds regions', () => {
  const image = { width: 1, height: 1, pixels: Buffer.alloc(3) };
  const region = { id: 'a', bounds: { x: 0, y: 0, w: 1, h: 1 } };
  expect(() => scoreSceneRegions(image, { ...image, width: 2 }, [region])).toThrow('dimensions');
  expect(() => scoreSceneRegions(image, image, [region, region])).toThrow('unique');
  expect(() => scoreSceneRegions(image, image, [{ ...region, bounds: { ...region.bounds, x: 1 } }])).toThrow('bounds');
});
