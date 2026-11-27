import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { compareGlass } from './compare.js';

it('writes evidence and enforces the parity thresholds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ogm-glass-parity-'));
  try {
    const make = (color: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        .png()
        .toBuffer();
    const black = await make('#000');
    const white = await make('#fff');
    expect((await compareGlass(black, black, dir, [])).pass).toBe(true);
    expect((await compareGlass(black, white, dir, [])).pass).toBe(false);
    expect(JSON.parse(await readFile(join(dir, 'score.json'), 'utf8')).deltaEOver3Percent).toBe(100);
    expect((await sharp(join(dir, 'side-by-side.png')).metadata()).width).toBe(16);
    expect((await sharp(join(dir, 'heatmap.png')).metadata()).width).toBe(8);
    await expect(compareGlass(black, await sharp(white).resize(4, 4).png().toBuffer(), dir, [])).rejects.toThrow(
      'identical dimensions',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
