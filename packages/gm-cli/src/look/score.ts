import sharp from 'sharp';

export type Rect = { x: number; y: number; w: number; h: number };
export type Image = { pixels: Buffer; width: number; height: number };

export async function image(path: string | Buffer, crop?: Rect): Promise<Image> {
  let input = sharp(path).flatten({ background: '#000000' }).toColourspace('srgb');
  if (crop) input = input.extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  const { data, info } = await input.raw().toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

export async function resize(path: string | Buffer, width: number, height: number, crop?: Rect): Promise<Image> {
  let input = sharp(path)
    .flatten({ background: '#000000' })
    .toColourspace('srgb')
    .resize(width, height, { fit: 'fill' });
  if (crop) input = input.extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  const { data, info } = await input.raw().toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

export function metrics(a: Image, b: Image, rect: Rect) {
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0,
    intersection = 0,
    union = 0;
  const ha = new Array<number>(48).fill(0),
    hb = new Array<number>(48).fill(0);
  const lum = (im: Image, x: number, y: number) => {
    const i = (y * im.width + x) * 3;
    return 0.299 * im.pixels[i]! + 0.587 * im.pixels[i + 1]! + 0.114 * im.pixels[i + 2]!;
  };
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const av = lum(a, x, y),
        bv = lum(b, x, y);
      sa += av;
      sb += bv;
      saa += av * av;
      sbb += bv * bv;
      sab += av * bv;
      const i = (y * a.width + x) * 3;
      for (let c = 0; c < 3; c++) {
        ha[c * 16 + (a.pixels[i + c]! >> 4)]!++;
        hb[c * 16 + (b.pixels[i + c]! >> 4)]!++;
      }
      if (x + 1 < rect.x + rect.w && y + 1 < rect.y + rect.h) {
        const ea = Math.abs(av - lum(a, x + 1, y)) + Math.abs(av - lum(a, x, y + 1)) > 24;
        const eb = Math.abs(bv - lum(b, x + 1, y)) + Math.abs(bv - lum(b, x, y + 1)) > 24;
        if (ea && eb) intersection++;
        if (ea || eb) union++;
      }
    }
  const n = rect.w * rect.h,
    ma = sa / n,
    mb = sb / n;
  const ssim =
    ((2 * ma * mb + 6.5025) * (2 * (sab / n - ma * mb) + 58.5225)) /
    ((ma * ma + mb * mb + 6.5025) * (saa / n - ma * ma + sbb / n - mb * mb + 58.5225));
  return {
    ssim,
    colourHistogramDistance: ha.reduce((sum, v, i) => sum + Math.abs(v - hb[i]!), 0) / (6 * n),
    edgeIoU: union ? intersection / union : 1,
  };
}

export async function sheet(a: Image, b: Image) {
  const heat = Buffer.alloc(a.pixels.length),
    overlay = Buffer.alloc(a.pixels.length);
  for (let i = 0; i < heat.length; i += 3) {
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(a.pixels[i + c]! - b.pixels[i + c]!)));
    heat[i] = d;
    heat[i + 1] = 0;
    heat[i + 2] = 0;
    for (let c = 0; c < 3; c++) overlay[i + c] = Math.round((a.pixels[i + c]! + b.pixels[i + c]!) / 2);
  }
  const raw = { width: a.width, height: a.height, channels: 3 as const };
  const panels = await Promise.all(
    [a.pixels, b.pixels, heat, overlay].map((pixels) => sharp(pixels, { raw }).png().toBuffer()),
  );
  return sharp({ create: { width: a.width * 4, height: a.height, channels: 3, background: '#000' } })
    .composite(panels.map((input, i) => ({ input, left: i * a.width, top: 0 })))
    .png()
    .toBuffer();
}
