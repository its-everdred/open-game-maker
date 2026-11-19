import sharp from 'sharp';

import { atomicWebp } from './sheet.js';
import { outputKey } from './key.js';

export type SpriteSheetOptions = {
  assetsRoot?: string;
  scale?: 1 | 2 | 3;
  width?: number;
  height?: number;
  pixelArt?: boolean;
};

export async function spriteSheet(
  png: string,
  out: string,
  options: SpriteSheetOptions = {},
): Promise<{ out: string; key: string }> {
  const key = outputKey(out, options.assetsRoot);
  const image = sharp(png);
  if (
    options.scale !== undefined ||
    (options.pixelArt && options.width === undefined && options.height === undefined)
  ) {
    const meta = await image.metadata();
    const scale = options.scale ?? 3;
    if (!meta.width || !meta.height) throw new Error('sprite dimensions are unavailable');
    image.resize(meta.width * scale, meta.height * scale, { kernel: sharp.kernel.nearest });
  } else if (options.width !== undefined || options.height !== undefined) {
    image.resize(options.width, options.height, {
      fit: 'contain',
      kernel: options.pixelArt ? sharp.kernel.nearest : sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  await atomicWebp(image, out, options.assetsRoot);
  return { out, key };
}
