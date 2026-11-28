import { expect, test, type Page } from '@playwright/test';

// Kevin's iPhone (#1298): the controls covered Dusk Helm's loading screen and the PLAY plaque on its title.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const controls = '[data-stick], [data-action]';

async function open(page: Page, query: string) {
  await page.goto(`/?template=menu&${query}`);
  const game = page.frameLocator('iframe[title="Game"]');
  await expect(game.locator('#play')).toBeVisible();
  const frame = page.frames().find((candidate) => candidate.url().includes('/g/menu-game/'))!;
  return { game, frame };
}

test('no controls cover the game while it loads, and they appear with its first frame', async ({ page }) => {
  const { frame } = await open(page, 'hold=1');
  await expect.poll(() => page.evaluate(() => window.__host.ready.length)).toBe(1);
  await expect(page.locator(controls).first()).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('loading.png') });
  await frame.evaluate(() => window.__drawFirstFrame());
  await expect(page.locator('[data-stick="move"]')).toBeVisible();
});

test('a title that asks for none shows no controls, and play shows them all', async ({ page }) => {
  const { game, frame } = await open(page, 'controls=none');
  /* Past loading, so the controls are hidden by the title's layout and not by the loading hold. */
  await expect.poll(() => page.evaluate(() => window.__host.loads.includes('load.frame'))).toBe(true);
  await expect(page.locator(controls)).toHaveCount(4);
  for (const control of await page.locator(controls).all()) await expect(control).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('title.png') });
  await game.locator('#play').tap();
  await expect.poll(() => frame.evaluate(() => window.__started)).toBe(true);
  for (const selector of ['[data-stick="move"]', '[data-action="attack"]', '[data-action="block"]']) {
    await expect(page.locator(selector)).toBeVisible();
  }
  await page.screenshot({ path: test.info().outputPath('gameplay.png') });
});

test('a menu layout keeps the stick, A and B and hides the rest', async ({ page }) => {
  await open(page, 'controls=menu');
  await expect(page.locator('[data-stick="move"]')).toBeVisible();
  await expect(page.locator('[data-action="attack"]')).toBeVisible();
  await expect(page.locator('[data-action="charge"]')).toBeVisible();
  await expect(page.locator('[data-action="block"]')).toBeHidden();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`declared D-pad and three actions fit without overlap at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, 'controls=gameplay');
    // The fixture omits the viewport meta tag supplied by the real shell.
    await page.evaluate(() => {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1';
      document.head.append(meta);
    });
    await expect.poll(() => page.evaluate(() => window.__host.ready.length)).toBe(1);
    await page.evaluate(() => {
      const overlay = window.__host.frame.overlay;
      overlay.setInputs(
        {
          actions: { move: 'stick', attack: 'button', block: 'button', run: 'button' },
          controls: {
            gameplay: {
              layout: 'dpad',
              stick: 'move',
              buttons: [
                { action: 'attack', icon: 'attack', label: 'Attack', behavior: 'tap' },
                { action: 'block', icon: 'block', label: 'Block', behavior: 'hold' },
                { action: 'run', icon: 'run', label: 'Run', behavior: 'hold' },
              ],
            },
          },
        },
        'stick',
      );
      overlay.setLayout('gameplay');
    });
    const elements = page.locator('[data-ogm-dpad] [data-direction], [data-action]');
    await expect(elements).toHaveCount(7);
    const boxes = await elements.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }),
    );
    for (const [index, box] of boxes.entries()) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
      for (const other of boxes.slice(index + 1)) {
        expect(
          box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top,
        ).toBe(true);
      }
    }
  });
}
