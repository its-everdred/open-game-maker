import { expect, it } from 'vitest';
import { rankRegisteredRegions } from '../src/scene/rank-registered.js';

it('ranks the worse registered region first and refuses uncovered render pixels', () => {
  const reference = { width: 2, height: 1, pixels: Buffer.from([255, 255, 255, 255, 255, 255]) };
  const render = { width: 2, height: 1, pixels: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]) };
  const regions = [
    { id: 'matching', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'different', bounds: { x: 1, y: 0, w: 1, h: 1 } },
  ];
  const ranked = rankRegisteredRegions(reference, render, regions);
  expect(ranked.map(({ id }) => id)).toEqual(['different', 'matching']);
  expect(ranked[0]!.mismatch).toBeGreaterThan(ranked[1]!.mismatch);
  render.pixels[7] = 0;
  expect(() => rankRegisteredRegions(reference, render, regions)).toThrow('incomplete registered coverage');
});
