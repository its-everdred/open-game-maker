import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Partition both images into matching native-pixel crops for manual review. */
export async function writeGlassCrops(reference: Buffer, actual: Buffer, output: string): Promise<void> {
  const { width, height } = await sharp(reference).metadata();
  if (!width || !height) throw new Error('Reference dimensions are unavailable');
  const columns = Math.min(3, width);
  const rows = Math.min(3, height);
  const directory = join(output, 'crops');
  await mkdir(directory, { recursive: true });
  const index: { file: string; x: number; y: number; width: number; height: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = Math.floor((column * width) / columns);
      const top = Math.floor((row * height) / rows);
      const cropWidth = Math.floor(((column + 1) * width) / columns) - left;
      const cropHeight = Math.floor(((row + 1) * height) / rows) - top;
      const bounds = { left, top, width: cropWidth, height: cropHeight };
      const [target, candidate] = await Promise.all([
        sharp(reference).removeAlpha().toColourspace('srgb').extract(bounds).png().toBuffer(),
        sharp(actual).removeAlpha().toColourspace('srgb').extract(bounds).png().toBuffer(),
      ]);
      const file = `row-${row + 1}-column-${column + 1}.png`;
      await sharp({ create: { width: cropWidth * 2, height: cropHeight, channels: 3, background: '#000' } })
        .composite([
          { input: target, left: 0, top: 0 },
          { input: candidate, left: cropWidth, top: 0 },
        ])
        .png()
        .toFile(join(directory, file));
      index.push({ file, x: left, y: top, width: cropWidth, height: cropHeight });
    }
  }
  await writeFile(join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
