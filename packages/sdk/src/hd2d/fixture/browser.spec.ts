import { expect, test } from '@playwright/test';

for (const renderer of ['phaser', 'three'] as const) {
  test(`${renderer} clearing steps deterministically and reports enabled mounts`, async ({ page }) => {
    const glErrors: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('GL_INVALID')) glErrors.push(message.text());
    });
    await page.goto(`/hd2d/?renderer=${renderer}&lighting=1&focus=1&particles=1&quality=high&seed=1`);
    await expect.poll(() => page.evaluate(() => window.__hd2d?.ready)).toBe(true);
    const result = await page.evaluate(async () => {
      const fixture = window.__hd2d;
      if (!fixture) throw new Error('fixture hooks missing');
      await fixture.frame(0);
      const start = fixture.hash();
      await fixture.frame(1000);
      const first = fixture.hash();
      await fixture.frame(1000);
      const second = fixture.hash();
      return { start, first, second, info: fixture.info() };
    });
    expect(result.first).toBe(result.second);
    expect(result.start).not.toBe(result.first);
    expect(result.info).toEqual({ renderer, mounted: ['lighting', 'focus', 'particles'] });
    expect(glErrors).toEqual([]);
  });
}

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
