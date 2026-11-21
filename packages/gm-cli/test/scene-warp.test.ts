import { expect, it } from 'vitest';
import { warpNearest } from '../src/scene/warp.js';

it('warps pixel art using destination-to-source coordinates and leaves uncovered pixels transparent', () => {
  const source = {
    width: 2,
    height: 2,
    pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
  };
  const warped = warpNearest(source, 3, 2, [1, 0, -1, 0, 1, 0, 0, 0, 1]);
  expect([...warped.pixels]).toEqual([
    0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
});

it('rejects invalid raster sizes', () => {
  expect(() =>
    warpNearest({ width: 2, height: 2, pixels: new Uint8Array(3) }, 1, 1, [1, 0, 0, 0, 1, 0, 0, 0, 1]),
  ).toThrow('dimensions');
  expect(() =>
    warpNearest({ width: 1, height: 1, pixels: new Uint8Array(4) }, 100001, 1001, [1, 0, 0, 0, 1, 0, 0, 0, 1]),
  ).toThrow('dimensions');
});

it('rejects invalid transforms and leaves only horizon pixels transparent', () => {
  const source = { width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255]) };
  expect(() => warpNearest(source, 1, 1, [NaN, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow('transform');
  expect(() => warpNearest(source, 1, 1, [0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow('transform');
  expect([...warpNearest(source, 2, 1, [1, 0, 0, 0, 1, 0, 1, 0, -1]).pixels]).toEqual([1, 2, 3, 255, 0, 0, 0, 0]);
});
