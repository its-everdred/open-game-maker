import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { realGroundTile } from '../fixtures/ground-path.js';

const here = fileURLToPath(new URL('.', import.meta.url));
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => console.error(error));
});
for (const width of [128, 256]) {
  test(`a ${width}px ground image meets adjacent cells and supports an actor`, async ({ page }) => {
    const bundle = await build({
      entryPoints: [`${here}/floor-scene.ts`],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
    });
    await page.setContent(
      `<body style="margin:0"><script>window.imageWidth=${width};${bundle.outputFiles[0]!.text}</script></body>`,
    );
    await page.waitForFunction(() => 'floorReady' in window);
    const pixels = await page.locator('canvas').evaluate((canvas) => {
      const source = canvas as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(source, 0, 0);
      const points: number[][] = [];
      for (let x = 2; x < 64; x += 2) {
        points.push([192 + x, 96 - x / 2], [192 - x, 96 - x / 2], [192 + x, 128 - x / 2], [192 - x, 128 - x / 2]);
      }
      return [...points, [192, 64], [192, 128], [192, 127]].map(([x, y]) =>
        Array.from(ctx.getImageData(x!, y!, 1, 1).data),
      );
    });
    for (const pixel of pixels.slice(0, -3)) expect(pixel[1]).toBeGreaterThan(185);
    expect(pixels.at(-3)![1]).toBeGreaterThan(185); // top cell survives camera culling
    expect(pixels.at(-2)![1]).toBeGreaterThan(100);
    expect(pixels.at(-1)![0]).toBeGreaterThan(200);
    await page.locator('canvas').screenshot({ path: `${here}/../../test-results/floor-${width}.png` });
    await page.evaluate(async () => {
      const floor = (
        window as unknown as { floor: { setScale(value: number): void; setPosition(x: number, y: number): void } }
      ).floor;
      floor.setScale(2);
      floor.setPosition(0, -200);
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    });
    const scaled = await page.locator('canvas').evaluate((source, x) => {
      const copy = document.createElement('canvas');
      copy.width = 400;
      copy.height = 280;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(source as HTMLCanvasElement, 0, 0);
      return Array.from(ctx.getImageData(x, 216, 1, 1).data);
    }, width);
    expect(scaled[1]).toBeGreaterThan(185);
  });
}

const fixture = resolve(here, '../fixtures/ground-diamond.png');
const realTile = realGroundTile();
for (const [label, path] of [
  ['fixture', fixture],
  ['real library tile', realTile],
] as const) {
  test(`ground edges meet using the ${label}`, async ({ page }) => {
    if (label === 'real library tile') test.skip(!path, 'Ground image unavailable in assets-local');
    const image = readFileSync(path!).toString('base64');
    const bundle = await build({
      entryPoints: [`${here}/floor-scene.ts`],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
    });
    await page.setContent(
      `<body style="margin:0"><script>window.imageWidth=128;window.imageSource='data:image/png;base64,${image}';${bundle.outputFiles[0]!.text}</script></body>`,
    );
    await page.waitForFunction(() => 'floorReady' in window);
    const pixels = await page.locator('canvas').evaluate((source) => {
      const copy = document.createElement('canvas');
      copy.width = 400;
      copy.height = 280;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(source as HTMLCanvasElement, 0, 0);
      return [
        [224, 80],
        [160, 80],
        [224, 144],
        [160, 144],
      ].map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data));
    });
    for (const pixel of pixels) expect(pixel.slice(0, 3)).not.toEqual([17, 24, 39]);
  });
}

for (const width of [128, 256]) {
  test(`Canvas renders a ${width}px image at the cell centre`, async ({ page }) => {
    const bundle = await build({
      entryPoints: [`${here}/floor-scene.ts`],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
    });
    await page.setContent(
      `<body style="margin:0"><script>window.imageWidth=${width};window.useCanvas=true;${bundle.outputFiles[0]!.text}</script></body>`,
    );
    await page.waitForFunction(() => 'floorReady' in window);
    const pixel = await page
      .locator('canvas')
      .evaluate((canvas) =>
        Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(224, 80, 1, 1).data),
      );
    expect(pixel[1]).toBeGreaterThan(185);
    await page.evaluate(() => {
      const floor = (window as unknown as { floor: { setVisible(value: boolean): void } }).floor;
      floor.setVisible(false);
    });
    await page.waitForTimeout(100);
    const hidden = await page
      .locator('canvas')
      .evaluate((canvas) =>
        Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(224, 80, 1, 1).data),
      );
    expect(hidden.slice(0, 3)).toEqual([17, 24, 39]);
  });
}

test('mixed image widths meet on the same floor', async ({ page }) => {
  const bundle = await build({
    entryPoints: [`${here}/floor-scene.ts`],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  await page.setContent(
    `<body style="margin:0"><script>window.imageWidth=128;window.mixed=true;${bundle.outputFiles[0]!.text}</script></body>`,
  );
  await page.waitForFunction(() => 'floorReady' in window);
  const pixels = await page.locator('canvas').evaluate((source) => {
    const copy = document.createElement('canvas');
    copy.width = 400;
    copy.height = 280;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(source as HTMLCanvasElement, 0, 0);
    const points = [
      [192, 64],
      [256, 96],
      [128, 96],
      [192, 160],
    ];
    for (let x = 2; x < 64; x += 2) points.push([192 + x, 96 - x / 2], [192 - x, 96 - x / 2]);
    return points.map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data));
  });
  for (const pixel of pixels) expect(pixel[1]).toBeGreaterThan(185);
});
