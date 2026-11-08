import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type GameHook = { bridgeState: string };

test.use({ serviceWorkers: 'block' });

/* Host chrome must never cover a game's own HUD (#641): Pause lives in the play bar, outside the game frame. */
const viewports = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  /* Between the phone and wide layouts the bar scrolls sideways; Pause must stay in view. */
  { width: 834, height: 1194 },
];

for (const viewport of viewports) {
  test(`Pause stays off the game at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets each acceptance viewport itself');
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page);
    await page.goto('/g/game?test');
    await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');

    const pause = page.getByRole('button', { name: 'Pause' });
    await expect(pause).toBeVisible();
    const pauseBox = await pause.boundingBox();
    const gameBox = await page.locator('.game-frame iframe').boundingBox();
    if (!pauseBox || !gameBox) throw new Error('Pause or game frame has no box');
    const overlaps =
      pauseBox.x < gameBox.x + gameBox.width &&
      gameBox.x < pauseBox.x + pauseBox.width &&
      pauseBox.y < gameBox.y + gameBox.height &&
      gameBox.y < pauseBox.y + pauseBox.height;
    expect(overlaps).toBe(false);
    const barBox = await page.locator('.play-bar').boundingBox();
    if (!barBox) throw new Error('play bar has no box');
    expect(pauseBox.x + pauseBox.width).toBeLessThanOrEqual(barBox.x + barBox.width);
    expect(pauseBox.y).toBeGreaterThanOrEqual(0);

    await pause.click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(pause).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`play-${viewport.width}x${viewport.height}.png`),
      timeout: 30_000,
    });
  });
}

function gameState(page: Page): Promise<GameHook | undefined> {
  return page.evaluate(() => (window as Window & { __ogmHost?: { game?: GameHook } }).__ogmHost?.game);
}
