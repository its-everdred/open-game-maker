import { expect, it } from 'vitest';
import sharp from 'sharp';
import { assertGameFramePainted } from './game-frame.js';

it('rejects a blank game frame even when surrounding controls are painted', async () => {
  const blank = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#26232b' } })
    .png()
    .toBuffer();
  await expect(assertGameFramePainted(blank, { x: 0, y: 0, width: 20, height: 20 }, 1)).rejects.toThrow('blank');
  const surrounding = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } })
    .composite([{ input: blank, left: 10, top: 10 }])
    .png()
    .toBuffer();
  await expect(assertGameFramePainted(surrounding, { x: 10, y: 10, width: 20, height: 20 }, 1)).rejects.toThrow(
    'blank',
  );
  const painted = await sharp(blank)
    .composite([{ input: { create: { width: 5, height: 10, channels: 3, background: '#ffffff' } }, left: 5, top: 5 }])
    .png()
    .toBuffer();
  await expect(assertGameFramePainted(painted, { x: 0, y: 0, width: 20, height: 20 }, 1)).resolves.toBeUndefined();
});
