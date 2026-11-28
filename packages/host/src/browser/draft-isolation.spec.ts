import { expect, test } from '@playwright/test';

test('a sibling game cannot read a draft URL while the opaque draft bridge reaches ready', async ({ page }) => {
  await page.goto('/?template=secure-draft');
  await expect.poll(() => page.evaluate(() => window.__host.ready[0]?.id), { timeout: 60_000 }).toBe('browser-fixture');
  const draft = page.locator('#game iframe');
  await expect(draft).toHaveAttribute('sandbox', 'allow-scripts allow-pointer-lock');
  const draftFrame = page.frames().find((frame) => frame.url().includes('/d/fixture/'))!;
  await expect.poll(() => draftFrame.locator('body').getAttribute('data-asset')).toBe('scoped asset');
  await page.evaluate(() => window.__host.forge());
  await expect.poll(() => page.frames().some((frame) => frame.url().endsWith('/forger.html'))).toBe(true);
  const sibling = page.frames().find((frame) => frame.url().endsWith('/forger.html'))!;
  const readable = await sibling.evaluate(() => {
    try {
      void window.parent.frames[0]!.location.href;
      return true;
    } catch {
      return false;
    }
  });
  expect(readable).toBe(false);
  expect(await page.evaluate(() => window.__host.errors)).toEqual([]);
});
