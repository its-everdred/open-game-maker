import { expect, it } from 'vitest';
import type { Homography } from '../src/scene/registration.js';
import { warpNearest } from '../src/scene/warp.js';

it('warps pixel art using destination-to-source coordinates and leaves uncovered pixels transparent', () => {
  const source = {
    width: 2,
    height: 2,
    pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
  };
  const warped = warpNearest(source, 3, 2, [1, 0, -1, 0, 1, 0, 0, 0, 1], [{ x: 1, y: 0 }]);
  expect([...warped.pixels]).toEqual([
    0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
});

it('rejects invalid raster sizes', () => {
  expect(() =>
    warpNearest(
      { width: 2, height: 2, pixels: new Uint8Array(3) },
      1,
      1,
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
      [{ x: 0, y: 0 }],
    ),
  ).toThrow('dimensions');
  expect(() =>
    warpNearest(
      { width: 1, height: 1, pixels: new Uint8Array(4) },
      100001,
      1001,
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
      [{ x: 0, y: 0 }],
    ),
  ).toThrow('dimensions');
});

it('rejects invalid transforms and leaves only horizon pixels transparent', () => {
  const source = { width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255]) };
  expect(() => warpNearest(source, 1, 1, [NaN, 0, 0, 0, 1, 0, 0, 0, 1], [{ x: 0, y: 0 }])).toThrow('transform');
  expect(() => warpNearest(source, 1, 1, [0, 0, 0, 0, 0, 0, 0, 0, 0], [{ x: 0, y: 0 }])).toThrow('transform');
  expect([...warpNearest(source, 2, 1, [1, 0, 0, 0, 1, 0, 1, 0, -1], [{ x: 0, y: 0 }]).pixels]).toEqual([
    1, 2, 3, 255, 0, 0, 0, 0,
  ]);
});

it('leaves pixels past the horizon transparent instead of sampling mirrored content', () => {
  const source = { width: 100, height: 100, pixels: new Uint8Array(100 * 100 * 4).fill(255) };
  const transform: Homography = [1, 0, -50, 0, 1, -50, 0, 0.1, -2];
  const warped = warpNearest(source, 100, 100, transform, [{ x: 60, y: 80 }]);
  const alphaAt = (x: number, y: number) => warped.pixels[(y * 100 + x) * 4 + 3];
  /* (20, 10) is past the horizon yet maps inside the source, to (30, 40). */
  expect(alphaAt(20, 10)).toBe(0);
  expect(alphaAt(60, 80)).toBe(255);
  expect(() =>
    warpNearest(source, 100, 100, transform, [
      { x: 60, y: 10 },
      { x: 60, y: 80 },
    ]),
  ).toThrow('one side');
});
