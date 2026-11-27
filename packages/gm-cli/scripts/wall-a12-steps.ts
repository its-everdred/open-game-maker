import sharp from 'sharp';

/** Preserve the lower treads and align them with the map renderer's ground anchor. */
export async function makeWallA12Steps(sourceBytes: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256 || info.channels !== 4) throw new Error('Unexpected source dimensions');
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      if (y < 196 + (x - 128) * 0.5) data[(y * 256 + x) * 4 + 3] = 0;
    }
  }
  const trimmed = await sharp(data, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer();
  const shifted = await sharp(trimmed).extract({ left: 5, top: 0, width: 251, height: 256 }).png().toBuffer();
  return sharp({ create: { width: 256, height: 288, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shifted, left: 0, top: 28 }])
    .png()
    .toBuffer();
}
