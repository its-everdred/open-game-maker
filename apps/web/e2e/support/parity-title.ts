import { expect, type Page } from '@playwright/test';

/** Freeze the real title-town frame at time zero for a reproducible comparison. */
export async function installTitleCapture(page: Page): Promise<void> {
  await page.route('**/town/index.html?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('capture')) return route.fallback();
    url.searchParams.set('capture', '');
    const destination = JSON.stringify(`${url.pathname}${url.search}`).replaceAll('<', '\\u003c');
    return route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${destination})</script>`,
    });
  });
}

/** Draw the capture frame and signal the normal poster-to-town transition. */
export async function settleTitleCapture(page: Page): Promise<void> {
  const frame = page.frameLocator('.title-town iframe');
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(() => {
            const town = window as unknown as { __frame?: unknown; __ready?: unknown };
            return town.__ready === true && typeof town.__frame === 'function';
          })
          .catch(() => false),
      { timeout: 60_000 },
    )
    .toBe(true);
  await frame.locator('body').evaluate(() => {
    (window as unknown as { __frame(time: number): void }).__frame(0);
    window.parent.postMessage('town-ready', window.location.origin);
  });
  await expect(page.locator('.title-town')).toHaveClass(/\blive\b/, { timeout: 30_000 });
  await expect(page.locator('.title-town .t-poster')).toHaveCount(0, { timeout: 30_000 });
}
