import { expect, test, type Page } from '@playwright/test';
import { sampleShaftIntensity } from './dapple.js';
import { renderLightField } from './field.js';
import { DEFAULT_FOREST_LIGHTING } from './schema.js';
import { FIXTURE_SKY } from '../fixture/sky-preset.js';

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

async function open(
  page: Page,
  renderer: string,
  quality: string,
  lighting: 0 | 1,
  sky = 0,
  weather = 'clear',
): Promise<void> {
  await page.goto(
    `/hd2d/?renderer=${renderer}&quality=${quality}&lighting=${lighting}&seed=1&sky=${sky}&weather=${weather}`,
  );
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
      const unlitStart = await sample(page, 0, [LANTERN]);
      const unlitLater = await sample(page, 500, [LANTERN]);

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
      // The lantern's own light (lit minus unlit) must change, not just the scene animating underneath it.
      const startGain = start.luma[0]! - unlitStart.luma[0]!;
      const laterGain = later.luma[0]! - unlitLater.luma[0]!;
      expect(laterGain - startGain).toBeGreaterThan(20);
    });

/** Keeps boxes clear of the lantern, whose own glow would swamp the sky light. */
const clearOfLantern = ({ x, y }: Box) => Math.hypot(x - LANTERN.x, y - LANTERN.y) > 110;

/**
 * Boxes picked from the expected light field of the `sky=1` preset at `timeMs`: the brightest beam pool and the
 * darkest spot at pool height, and the deepest cloud shadow and sunniest open ground in the lower half (no beams there).
 */
function skyBoxes(timeMs: number): { pool: Box; dim: Box; cloud: Box; sun: Box } {
  const field = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  renderLightField(field, WIDTH, HEIGHT, FIXTURE_SKY, timeMs, 1, []);
  const mean = (x: number, y: number, channel: number) => {
    let sum = 0;
    for (let sy = 0; sy < BOX; sy += 2)
      for (let sx = 0; sx < BOX; sx += 2) sum += field[((y + sy) * WIDTH + x + sx) * 4 + channel]!;
    return sum / (BOX * BOX) / 4;
  };
  const boxes: Array<Box & { light: number; keep: number }> = [];
  for (let y = 0; y <= HEIGHT - BOX; y += 8)
    for (let x = 0; x <= WIDTH - BOX; x += 8)
      if (clearOfLantern({ x, y })) boxes.push({ x, y, light: mean(x, y, 0), keep: mean(x, y, 3) });
  const poolBand = boxes.filter((box) => box.y > HEIGHT * 0.25 && box.y < HEIGHT * 0.5);
  const lower = boxes.filter((box) => box.y > HEIGHT * 0.6);
  const by = <T>(list: T[], score: (item: T) => number) => list.reduce((a, b) => (score(b) > score(a) ? b : a));
  return {
    pool: by(poolBand, (box) => box.light),
    dim: by(poolBand, (box) => -box.light - (255 - box.keep)),
    cloud: by(lower, (box) => -box.keep),
    sun: by(lower, (box) => box.keep + box.light),
  };
}

for (const renderer of ['phaser', 'three'] as const)
  for (const quality of ['high', 'low'] as const)
    test(`${renderer} sky at quality=${quality} lights beam pools and shades under clouds`, async ({ page }) => {
      const { pool, dim, cloud, sun } = skyBoxes(1000);
      const boxes = [pool, dim, cloud, sun];
      await open(page, renderer, quality, 0, 1);
      const unlit = await sample(page, 1000, boxes);
      await open(page, renderer, quality, 1, 1);
      const lit = await sample(page, 1000, boxes);
      // Lit minus unlit cancels the test art under each box, leaving only what the sky did there.
      const gain = lit.luma.map((value, index) => value - unlit.luma[index]!);
      expect(gain[0]!).toBeGreaterThan(gain[1]! + 15);
      expect(gain[3]!).toBeGreaterThan(gain[2]! + 10);
      // The clouds drift: the same scene a few seconds on is shaded differently.
      const later = await sample(page, 6000, boxes);
      expect(later.hash).not.toBe(lit.hash);
    });

// Kevin: shafts happen only in certain biomes under certain weather. The fixture's forest allows them in clear weather.
for (const renderer of ['phaser', 'three'] as const)
  test(`${renderer} sky drops the shafts in rain but keeps the clouds`, async ({ page }) => {
    const { pool, dim, cloud, sun } = skyBoxes(1000);
    const boxes = [pool, dim, cloud, sun];
    await open(page, renderer, 'high', 0, 1, 'rain');
    const unlit = await sample(page, 1000, boxes);
    await open(page, renderer, 'high', 1, 1, 'rain');
    const lit = await sample(page, 1000, boxes);
    const gain = lit.luma.map((value, index) => value - unlit.luma[index]!);
    // No beam, no pool: the pool box gains no more than the dim box beside it (allowing for cloud differences).
    expect(gain[0]!).toBeLessThan(gain[1]! + 8);
    expect(gain[3]!).toBeGreaterThan(gain[2]! + 10);
  });
