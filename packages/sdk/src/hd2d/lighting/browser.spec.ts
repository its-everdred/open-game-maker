import { expect, test, type Page } from '@playwright/test';
import { sampleShaftIntensity } from './dapple.js';
import { DEFAULT_FOREST_LIGHTING } from './schema.js';

const WIDTH = 640;
const HEIGHT = 360;
const BOX = 24;
const LANTERN = { x: 470 - BOX / 2, y: 285 - BOX / 2 };

interface Box {
  x: number;
  y: number;
}

/** The upper-band boxes where the forest preset's shafts are strongest and weakest at `timeMs`. */
function shaftBoxes(timeMs: number): { shaft: Box; shadow: Box } {
  const boxes: Array<Box & { value: number }> = [];
  for (let y = 20; y <= 120 - BOX; y += 8)
    for (let x = 0; x <= WIDTH - BOX; x += 8) {
      let value = 0;
      for (let sy = 0; sy < BOX; sy += 4)
        for (let sx = 0; sx < BOX; sx += 4)
          value += sampleShaftIntensity(DEFAULT_FOREST_LIGHTING, (x + sx) / WIDTH, (y + sy) / HEIGHT, timeMs);
      boxes.push({ x, y, value });
    }
  boxes.sort((a, b) => b.value - a.value);
  return { shaft: boxes[0]!, shadow: boxes.at(-1)! };
}

async function open(page: Page, renderer: string, quality: string, lighting: 0 | 1): Promise<void> {
  await page.goto(`/hd2d/?renderer=${renderer}&quality=${quality}&lighting=${lighting}&seed=1`);
  await expect.poll(() => page.evaluate(() => window.__hd2d?.ready)).toBe(true);
}

/** Steps the fixture to `ms`, then returns its hash and the mean luminance of each box. */
function sample(page: Page, ms: number, boxes: Box[]): Promise<{ hash: string; luma: number[] }> {
  return page.evaluate(
    async ({ ms, boxes, size }) => {
      const fixture = window.__hd2d!;
      await fixture.frame(ms);
      const hash = fixture.hash();
      const source = document.querySelector<HTMLCanvasElement>('#game')!;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(source, 0, 0);
      const luma = boxes.map(({ x, y }) => {
        const data = ctx.getImageData(x, y, size, size).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4)
          sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        return sum / (size * size);
      });
      return { hash, luma };
    },
    { ms, boxes, size: BOX },
  );
}

for (const renderer of ['phaser', 'three'] as const)
  for (const quality of ['high', 'low'] as const)
    test(`${renderer} lighting at quality=${quality} is stable, visible, shafted and flickers`, async ({ page }) => {
      const { shaft, shadow } = shaftBoxes(1000);

      await open(page, renderer, quality, 0);
      const unlit = await sample(page, 1000, [shaft, shadow]);

      await open(page, renderer, quality, 1);
      const first = await sample(page, 1000, [shaft, shadow]);
      const second = await sample(page, 1000, [shaft, shadow]);
      expect(second.hash).toBe(first.hash);
      expect(first.hash).not.toBe(unlit.hash);
      // Compare against the unlit frame so the art under each box cancels out: the shaft adds light, shadow takes it.
      const shaftGain = first.luma[0]! - unlit.luma[0]!;
      const shadowGain = first.luma[1]! - unlit.luma[1]!;
      expect(shaftGain).toBeGreaterThan(shadowGain + 10);
      expect(first.luma[0]!).toBeGreaterThan(first.luma[1]!);

      const start = await sample(page, 0, [LANTERN]);
      const later = await sample(page, 500, [LANTERN]);
      expect(later.hash).not.toBe(start.hash);
      expect(Math.abs(later.luma[0]! - start.luma[0]!)).toBeGreaterThan(1);
    });

declare global {
  interface Window {
    __hd2d?: {
      ready: boolean;
      frame(ms: number): Promise<void>;
      hash(): string;
      info(): { renderer: 'phaser' | 'three'; mounted: string[] };
    };
  }
}
