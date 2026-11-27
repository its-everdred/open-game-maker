import sharp from 'sharp';
import { expect, it } from 'vitest';
import { makeWallA12Steps } from '../scripts/wall-a12-steps.js';

it('keeps the lower staircase pixels and aligns them without stretching or cropping', async () => {
  const source = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const { data, info } = await sharp(await makeWallA12Steps(source))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x + 1) * 4)];
  expect([info.width, info.height, info.channels]).toEqual([256, 288, 4]);
  expect(pixel(123, 223)[3]).toBe(0); // The pixel just above the cut at source (128,195).
  expect(pixel(123, 224)).toEqual([40, 80, 120, 255]); // The first kept pixel at (128,196).
  expect(pixel(123, 283)).toEqual([40, 80, 120, 255]); // Bottom source row survives the anchor shift.
  expect(pixel(251, 250)[3]).toBe(0); // Horizontal shift does not wrap pixels around.
});

it('rejects a source with the wrong dimensions', async () => {
  const wrong = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'white' } })
    .png()
    .toBuffer();
  await expect(makeWallA12Steps(wrong)).rejects.toThrow('Unexpected source dimensions');
});
