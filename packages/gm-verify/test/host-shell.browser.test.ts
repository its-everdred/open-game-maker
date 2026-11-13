import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { hostFrameUrl, launch } from '../src/browser.js';
import { serveStatic } from '../src/server.js';

const shellDir = fileURLToPath(new URL('../dist/shell/', import.meta.url));
const gameDir = fileURLToPath(new URL('../fixtures/stub-game/', import.meta.url));
let shell: Awaited<ReturnType<typeof serveStatic>>;
let game: Awaited<ReturnType<typeof serveStatic>>;
beforeAll(async () => {
  shell = await serveStatic(shellDir);
  game = await serveStatic(gameDir);
});
afterAll(async () => {
  await shell.close();
  await game.close();
});

it.each([
  { width: 390, height: 844 },
  { width: 1180, height: 820 },
])('fills the $width x $height play viewport with the game and one menu control', async (viewport) => {
  const browser = await launch(process.env.GM_VERIFY_SOFTWARE_GL === '1');
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(hostFrameUrl(shell.url, game.url, 'mobile', 'Test game'));
    const stage = await page.locator('.game-stage').boundingBox();
    expect(stage).toEqual({ x: 0, y: 0, ...viewport });
    expect(await page.locator('.game-frame iframe').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Menu' }).count()).toBe(1);
    expect(await page.locator('.play-bar').count()).toBe(0);
  } finally {
    await browser.close();
  }
});
