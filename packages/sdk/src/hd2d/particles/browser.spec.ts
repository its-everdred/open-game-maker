import { expect, test, type Page } from '@playwright/test';

/** Opens the clearing, steps it to 2000 ms twice, and returns both hashes and the drawn particle count. */
async function render(page: Page, renderer: string, particles: 0 | 1, quality: 'low' | 'high') {
  await page.goto(`/hd2d/?renderer=${renderer}&particles=${particles}&quality=${quality}&seed=7`);
  await expect.poll(() => page.evaluate(() => window.__hd2d?.ready)).toBe(true);
  return page.evaluate(async () => {
    const fixture = window.__hd2d!;
    await fixture.frame(2000);
    const first = fixture.hash();
    await fixture.frame(2000);
    return { first, second: fixture.hash(), count: window.__hd2dParticles?.count() };
  });
}

for (const renderer of ['phaser', 'three'] as const)
  test(`${renderer} particles are deterministic, visible, and halved at low quality`, async ({ page }) => {
    const high = await render(page, renderer, 1, 'high');
    expect(high.second).toBe(high.first);
    // A reload replays the same seed to the same pixels.
    const reloaded = await render(page, renderer, 1, 'high');
    expect(reloaded.first).toBe(high.first);

    const none = await render(page, renderer, 0, 'high');
    expect(none.first).not.toBe(high.first);

    const low = await render(page, renderer, 1, 'low');
    expect(high.count).toBeGreaterThan(0);
    expect(low.count).toBeGreaterThan(0);
    expect(low.count).toBeLessThanOrEqual(high.count! / 2);
  });

declare global {
  interface Window {
    __hd2d?: {
      ready: boolean;
      frame(ms: number): Promise<void>;
      hash(): string;
      info(): { renderer: 'phaser' | 'three'; mounted: string[] };
    };
    __hd2dParticles?: { count(): number };
  }
}
