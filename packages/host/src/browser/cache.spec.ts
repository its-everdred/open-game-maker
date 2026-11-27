import { expect, test } from '@playwright/test';

const gameOrigin = 'http://127.0.0.1:4174';
const blobPath = `/a/${'a'.repeat(64)}.glb`;
const buildCodePath = (buildId: string) => `/g/cache-game/${buildId}/game.js`;

test('shares blobs across builds and keeps build code immutable', async ({ page, request }) => {
  await request.delete(`${gameOrigin}/test/request-counts`);
  const workerResponses: Array<{ url: string; fromServiceWorker: boolean }> = [];
  page.on('response', (response) => {
    if (response.url().startsWith(gameOrigin)) {
      workerResponses.push({ url: response.url(), fromServiceWorker: response.fromServiceWorker() });
    }
  });

  await page.goto(`${gameOrigin}/g/cache-game/b1/index.html`);
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  // The worker serves the response before its background cache write completes.
  // Wait for that write before testing reuse by a different build.
  await page.waitForFunction(
    async (url) => Boolean(await (await caches.open('gm-blobs-v1')).match(url)),
    `${gameOrigin}${blobPath}`,
  );

  await page.goto(`${gameOrigin}/g/cache-game/b2/index.html`);
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');
  await page.waitForFunction(
    async (url) => Boolean(await (await caches.open('gm-builds-v1')).match(url)),
    `${gameOrigin}${buildCodePath('b2')}`,
  );

  const afterSecondBuild = (await (await request.get(`${gameOrigin}/test/request-counts`)).json()) as Record<
    string,
    number
  >;
  expect(afterSecondBuild[blobPath]).toBe(1);
  expect(afterSecondBuild[buildCodePath('b2')]).toBe(1);

  const cached = await page.evaluate(
    async ({ blobUrl, buildUrl }) => ({
      names: await caches.keys(),
      blob: Boolean(await (await caches.open('gm-blobs-v1')).match(blobUrl)),
      build: Boolean(await (await caches.open('gm-builds-v1')).match(buildUrl)),
    }),
    {
      blobUrl: `${gameOrigin}${blobPath}`,
      buildUrl: `${gameOrigin}${buildCodePath('b2')}`,
    },
  );
  expect(cached).toEqual({ names: ['gm-blobs-v1', 'gm-builds-v1'], blob: true, build: true });

  expect(
    workerResponses.some((response) => response.url === `${gameOrigin}${blobPath}` && response.fromServiceWorker),
  ).toBe(true);
  expect(workerResponses.filter((response) => response.url === `${gameOrigin}${buildCodePath('b2')}`)).toEqual([
    { url: `${gameOrigin}${buildCodePath('b2')}`, fromServiceWorker: true },
  ]);

  await page.reload();
  await expect(page.locator('#cache-result')).toHaveText('fixture-asset');

  const afterReload = (await (await request.get(`${gameOrigin}/test/request-counts`)).json()) as Record<string, number>;
  expect(afterReload[blobPath]).toBe(1);
  expect(afterReload[buildCodePath('b2')]).toBe(1);
  expect(workerResponses.filter((response) => response.url === `${gameOrigin}${buildCodePath('b2')}`)).toEqual([
    { url: `${gameOrigin}${buildCodePath('b2')}`, fromServiceWorker: true },
    { url: `${gameOrigin}${buildCodePath('b2')}`, fromServiceWorker: true },
  ]);
});
