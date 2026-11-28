import { expect, test } from '@playwright/test';

const gameOrigin = 'http://127.0.0.1:4174';
const blobPath = `/a/${'a'.repeat(64)}.glb`;
const buildCodePath = (buildId: string) => `/g/cache-game/${buildId}/game.js`;

test('fetches artifacts from the host on every load', async ({ page, request }) => {
  await request.delete(`${gameOrigin}/test/request-counts`);

  await page.goto(`${gameOrigin}/g/cache-game/b1/index.html`);
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  await page.goto(`${gameOrigin}/g/cache-game/b2/index.html`);
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  await page.reload();
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');

  const counts = (await (await request.get(`${gameOrigin}/test/request-counts`)).json()) as Record<string, number>;
  expect(counts[blobPath]).toBe(3);
  expect(counts[buildCodePath('b2')]).toBe(2);
  expect(await page.evaluate(() => caches.keys())).not.toEqual(expect.arrayContaining(['gm-blobs-v1']));
  expect(await page.evaluate(() => caches.keys())).not.toEqual(expect.arrayContaining(['gm-builds-v1']));
});
