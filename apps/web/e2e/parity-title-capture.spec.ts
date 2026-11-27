import { expect, test } from '@playwright/test';
import { installTitleCapture, settleTitleCapture } from './support/parity-title';

test('title parity freezes the frame and completes the poster transition', async ({ page }) => {
  await page.route('**/title-capture-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<div class="title-town"><div class="t-poster"></div><iframe src="/town/index.html?cam=menu&amp;embed"></iframe></div>
        <script>addEventListener('message', e => { const town = document.querySelector('.title-town');
          if (e.source === town.querySelector('iframe').contentWindow && e.data === 'town-ready') {
            town.classList.add('live'); town.querySelector('.t-poster').remove();
          } });</script>`,
    }),
  );
  await page.route('**/town/index.html?*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<body><script>let checks = 0; Object.defineProperty(window, "__ready", { get: () => ++checks >= 2 }); window.__frame = t => { if (checks < 2) throw new Error("town not ready"); window.frameTime = t; };</script></body>',
    }),
  );
  await installTitleCapture(page);
  await page.goto('/title-capture-harness');
  await settleTitleCapture(page);
  const frame = page.frameLocator('.title-town iframe');
  expect(await frame.locator('body').evaluate(() => (window as unknown as { frameTime: number }).frameTime)).toBe(0);
  expect(new URL(page.frames()[1]!.url()).searchParams.has('capture')).toBe(true);
});
