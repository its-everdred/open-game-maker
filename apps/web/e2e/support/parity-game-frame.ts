import type { Page } from '@playwright/test';
import { assertGameFramePainted } from '../../../../packages/gm-cli/src/design-parity/game-frame';

/** Inspect the game without shell overlays counting as painted game pixels. */
export async function assertIsolatedGameFramePainted(page: Page, scale: number): Promise<void> {
  const frame = page.locator('.game-frame iframe');
  const bounds = await frame.boundingBox();
  if (!bounds) throw new Error('Game frame is not visible');
  const style = await page.addStyleTag({
    content:
      'body * { visibility: hidden !important; } .game-frame, .game-frame iframe { visibility: visible !important; } .game-frame::before, .game-frame::after { visibility: hidden !important; }',
  });
  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({ timeout: 120_000 });
  } finally {
    await style.evaluate((element) => element.remove());
  }
  await assertGameFramePainted(screenshot, bounds, scale);
}
