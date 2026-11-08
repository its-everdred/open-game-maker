import type { Page } from 'playwright';

/** `[x, y, width, height]` in viewport fractions. */
export type Region = readonly [number, number, number, number];

/** Luminance spread (0-255) below which a frame is one flat colour: a blank canvas, a black or white page. */
export const BLANK_STDDEV = 3;
/** Fraction of sampled pixels that must differ for a region to count as changed. */
export const CHANGED_FRACTION = 0.001;
/** A per-channel difference smaller than this is compression or dithering noise, not change. */
const PIXEL_TOLERANCE = 24;

export type PixelStats = { stddev: number; changedFraction: number | null };

/**
 * Decodes PNG screenshots inside the page (no image library on the Node side) and measures the region: the luminance
 * standard deviation of `png`, and when `before` is given the fraction of pixels that differ from it.
 */
export async function pixelStats(page: Page, png: Buffer, before?: Buffer, region?: Region): Promise<PixelStats> {
  return page.evaluate(
    async ({ now, then, area, tolerance }) => {
      async function read(b64: string): Promise<ImageData> {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const [fx, fy, fw, fh] = area ?? [0, 0, 1, 1];
        const x = Math.floor(fx * bitmap.width);
        const y = Math.floor(fy * bitmap.height);
        const w = Math.max(1, Math.min(bitmap.width - x, Math.round(fw * bitmap.width)));
        const h = Math.max(1, Math.min(bitmap.height - y, Math.round(fh * bitmap.height)));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
      }
      const a = await read(now);
      let sum = 0;
      let sq = 0;
      const n = a.width * a.height;
      for (let i = 0; i < a.data.length; i += 4) {
        const l = 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
        sum += l;
        sq += l * l;
      }
      const mean = sum / n;
      const stddev = Math.sqrt(Math.max(0, sq / n - mean * mean));
      if (then === null) return { stddev, changedFraction: null };
      const b = await read(then);
      if (b.width !== a.width || b.height !== a.height) return { stddev, changedFraction: 1 };
      let changed = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        if (
          Math.abs(a.data[i]! - b.data[i]!) > tolerance ||
          Math.abs(a.data[i + 1]! - b.data[i + 1]!) > tolerance ||
          Math.abs(a.data[i + 2]! - b.data[i + 2]!) > tolerance
        )
          changed += 1;
      }
      return { stddev, changedFraction: changed / n };
    },
    {
      now: png.toString('base64'),
      then: before ? before.toString('base64') : null,
      area: region ? [...region] : null,
      tolerance: PIXEL_TOLERANCE,
    },
  );
}

/** A frame for measuring only: CSS pixels, so a 2x phone decodes a quarter of the pixels on every poll. */
export function frame(page: Page): Promise<Buffer> {
  return page.screenshot({ scale: 'css' });
}

export function isBlank(stats: PixelStats): boolean {
  return stats.stddev < BLANK_STDDEV;
}

export function isChanged(stats: PixelStats): boolean {
  return (stats.changedFraction ?? 0) >= CHANGED_FRACTION;
}
