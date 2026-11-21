import { expect, test, type Page } from '@playwright/test';

// The hero is 16x24 art at scale 2, centred on (320, 252); its bob is 0 px at t=1000 ms.
const HERO = { x: 304, y: 228, width: 32, height: 48 };
// The far tree line behind the clearing.
const BACKGROUND = { x: 0, y: 40, width: 640, height: 90 };

async function render(page: Page, renderer: 'phaser' | 'three', focus: 0 | 1, quality: 'low' | 'high') {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto(`/hd2d/?renderer=${renderer}&focus=${focus}&quality=${quality}&seed=1`);
  await expect.poll(() => page.evaluate(() => window.__hd2d?.ready)).toBe(true);
  return page.evaluate(
    async ({ hero, background }) => {
      const fixture = window.__hd2d!;
      await fixture.frame(0);
      await fixture.frame(1000);
      const first = fixture.hash();
      await fixture.frame(1000);
      const second = fixture.hash();
      const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d')!;
      context.drawImage(canvas, 0, 0);
      const pixels = (box: typeof hero) => context.getImageData(box.x, box.y, box.width, box.height).data;
      // Mean luminance difference between horizontal neighbours: high for crisp detail, low when blurred.
      const contrast = (box: typeof hero) => {
        const data = pixels(box);
        const luma = (at: number) => 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
        let sum = 0;
        for (let y = 0; y < box.height; y += 1)
          for (let x = 1; x < box.width; x += 1) {
            const at = (y * box.width + x) * 4;
            sum += Math.abs(luma(at) - luma(at - 4));
          }
        return sum / (box.height * (box.width - 1));
      };
      return { first, second, hero: Array.from(pixels(hero)), contrast: contrast(background) };
    },
    { hero: HERO, background: BACKGROUND },
  );
}

for (const renderer of ['phaser', 'three'] as const)
  for (const quality of ['high', 'low'] as const) {
    test(`${renderer} focus at ${quality} blurs the background, never the hero`, async ({ page }) => {
      const on = await render(page, renderer, 1, quality);
      const off = await render(page, renderer, 0, quality);
      expect(on.first).toBe(on.second);
      expect(on.first).not.toBe(off.first);
      expect(on.hero).toEqual(off.hero);
      expect(on.contrast).toBeLessThan(off.contrast * 0.8);
    });
  }
