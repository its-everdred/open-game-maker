import { expect, test } from '@playwright/test';
import { assertGameFramePainted } from '../../../packages/gm-cli/src/design-parity/game-frame';
import { assertIsolatedGameFramePainted } from './support/parity-game-frame';

test.use({ deviceScaleFactor: 1 });

test('a shell overlay cannot make a blank game frame look painted', async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { margin: 0; }
      iframe { width: 300px; height: 300px; border: 0; }
      .overlay { position: absolute; top: 100px; left: 100px; width: 100px; height: 100px; background: white; }
      .game-frame::after { content: ''; position: absolute; top: 140px; left: 140px; width: 30px; height: 30px; background: white; }
    </style>
    <main><div class="game-frame"><iframe srcdoc="<body style='margin:0;background:#26232b'></body>"></iframe><div class="overlay"></div></div></main>
  `);
  await expect(page.locator('.game-frame iframe')).toBeVisible();
  const bounds = await page.locator('.game-frame iframe').boundingBox();
  if (!bounds) throw new Error('Game frame is not visible');
  await expect(assertGameFramePainted(await page.screenshot(), bounds, 1)).resolves.toBeUndefined();
  await expect(assertIsolatedGameFramePainted(page, 1)).rejects.toThrow('Game frame is blank');
  await expect(page.locator('.overlay')).toBeVisible();
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    frame.srcdoc =
      "<body style='margin:0'><div style='width:300px;height:300px;background:linear-gradient(90deg,black 50%,white 50%)'></div></body>";
  });
  await expect(page.frameLocator('iframe').locator('div')).toHaveCSS('background-image', /linear-gradient/);
  await expect(assertIsolatedGameFramePainted(page, 1)).resolves.toBeUndefined();
  await expect(page.locator('.overlay')).toBeVisible();
});
