import { expect, test } from '@playwright/test';

const gameOrigin = 'http://127.0.0.1:4174';
const blobPath = `/a/${'a'.repeat(64)}.glb`;
const buildCodePath = '/g/cache-game/b2/game.js';

test('rechecks build and shared asset requests after a reload', async ({ page, request }) => {
  await request.delete(`${gameOrigin}/test/request-counts`);
  await page.goto(`${gameOrigin}/g/cache-game/b1/index.html`);
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  await page.goto(`${gameOrigin}/g/cache-game/b2/index.html`);
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  const before = (await (await request.get(`${gameOrigin}/test/request-counts`)).json()) as Record<string, number>;
  await page.reload();
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  const after = (await (await request.get(`${gameOrigin}/test/request-counts`)).json()) as Record<string, number>;
  expect(after[blobPath]).toBeGreaterThan(before[blobPath] ?? 0);
  expect(after[buildCodePath]).toBeGreaterThan(before[buildCodePath] ?? 0);
});
