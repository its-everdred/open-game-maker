import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

test.use({ serviceWorkers: 'block' });

test('opens a no-build diorama and places a locked item', async ({ page }, testInfo) => {
  test.slow();
  await installAuthRoutes(page, { signedIn: true });
  const api = await installGameApi(page);
  const assetUrl = '/api/v1/games/game/scenery/assets/0/hash/tree.glb';
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/games/game/branches/main/design')
      return route.fulfill({ json: { rev: 0, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } } });
    if (path === '/api/v1/games/game/scenery/source')
      return route.fulfill({
        json: {
          scene: {
            version: 1,
            items: [],
            terrain: [],
            lighting: 'warm-forest',
            camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
          },
          assets: [{ id: 't3:fixture/tree', path: 'tree.glb', url: assetUrl }],
        },
      });
    if (path === assetUrl)
      return route.fulfill({
        contentType: 'model/gltf-binary',
        body: readFileSync(new URL('../../../packages/sdk/test/fixtures/cube.meshopt.glb', import.meta.url)),
      });
    return route.fallback();
  });
  await page.goto('/g/game?mode=edit&test');
  const canvas = page.getByLabel('Editor canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.game-frame canvas')).toBeVisible();
  await expect.poll(() => api.transactions.length).toBe(1);
  await page.getByRole('button', { name: 'tree', exact: true }).click();
  const model = page.waitForResponse((response) => new URL(response.url()).pathname === assetUrl);
  await canvas.click({ position: { x: 180, y: 200 } });
  await expect.poll(() => api.transactions.length).toBe(2);
  expect((await model).ok()).toBe(true);
  await expect(page.locator('.game-frame canvas')).toHaveAttribute('data-scenery-items', '1');
  await expect(page.locator('.screen-error')).toHaveCount(0);
  expect(api.transactions[1]?.commands).toEqual([expect.objectContaining({ command: 'entity.create' })]);
  await page.screenshot({ path: testInfo.outputPath('scenery-preview.png') });
});
