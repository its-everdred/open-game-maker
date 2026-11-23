import { expect, test, type Page } from '@playwright/test';

// Kevin plays on a phone: the title must start from the on-screen controller, a keyboard or a pad, not only a tap.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openTitle(page: Page) {
  await page.goto('/?template=menu');
  const game = page.frameLocator('iframe[title="Game"]');
  await expect(game.locator('#play[data-gm-focus]')).toBeVisible();
  const frame = page.frames().find((candidate) => candidate.url().includes('/g/menu-game/'))!;
  expect(await frame.evaluate(() => window.__started)).toBe(false);
  return { game, frame };
}

test('the on-screen A button starts the game from the title', async ({ page }) => {
  const { frame } = await openTitle(page);
  const a = page.locator('button[data-action="attack"]');
  await expect(a).toBeVisible();
  await a.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
  await a.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
  await expect.poll(() => frame.evaluate(() => window.__started)).toBe(true);
});

test('Enter starts the game from the title', async ({ page }) => {
  const { game, frame } = await openTitle(page);
  await game.locator('body').evaluate(() => window.focus());
  await page.keyboard.press('ArrowLeft');
  await expect(game.locator('#settings[data-gm-focus]')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => frame.evaluate(() => window.__started)).toBe(true);
});

test("a connected gamepad's A button starts the game from the title", async ({ page }) => {
  // A simulated standard pad on the host page, which polls pads for a game frame that does not have focus.
  await page.addInitScript(() => {
    if (location.port !== '4173') return;
    window.__pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    const pad = { id: 'simulated', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0] };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [{ ...pad, buttons: window.__pad.buttons }],
    });
  });
  const { frame } = await openTitle(page);
  await page.evaluate(() => Object.assign(window.__pad.buttons[0]!, { pressed: true, value: 1 }));
  await expect.poll(() => frame.evaluate(() => window.__started)).toBe(true);
});
