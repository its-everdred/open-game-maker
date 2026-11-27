import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { glassMetrics, type PixelMask } from './metrics.js';
import { readMasks } from './masks.js';

/** Compare native-pixel captures and write review artifacts even on a failed score. */
export async function compareGlass(reference: Buffer, actual: Buffer, output: string, masks: PixelMask[]) {
  const [a, b] = await Promise.all([
    sharp(reference).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }),
    sharp(actual).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    a.info.width !== b.info.width ||
    a.info.height !== b.info.height ||
    a.info.channels !== 3 ||
    b.info.channels !== 3
  ) {
    throw new Error('Reference and capture must have identical dimensions and RGB channels');
  }
  const { width, height } = a.info;
  const score = glassMetrics(a.data, b.data, width, height, masks);
  const heat = Buffer.alloc(a.data.length);
  for (let i = 0; i < heat.length; i += 3) {
    const delta = Math.max(
      Math.abs(a.data[i]! - b.data[i]!),
      Math.abs(a.data[i + 1]! - b.data[i + 1]!),
      Math.abs(a.data[i + 2]! - b.data[i + 2]!),
    );
    heat[i] = Math.min(255, delta * 4);
  }
  const pair = await sharp({ create: { width: width * 2, height, channels: 3, background: '#000' } })
    .composite([
      { input: reference, left: 0, top: 0 },
      { input: actual, left: width, top: 0 },
    ])
    .png()
    .toBuffer();
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(join(output, 'side-by-side.png'), pair),
    sharp(heat, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(join(output, 'heatmap.png')),
    writeFile(
      join(output, 'score.json'),
      `${JSON.stringify({ ...score, pass: score.ssim >= 0.97 && score.deltaEOver3Percent <= 1 }, null, 2)}\n`,
    ),
  ]);
  return { ...score, pass: score.ssim >= 0.97 && score.deltaEOver3Percent <= 1 };
}

/** Use the reviewed mask registry for a named reference. */
export async function compareGlassScreen(
  reference: Buffer,
  actual: Buffer,
  output: string,
  masksFile: string,
  screen: string,
) {
  return compareGlass(reference, actual, output, await readMasks(masksFile, screen));
}
