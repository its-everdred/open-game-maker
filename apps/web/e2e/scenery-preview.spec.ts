import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

test.use({ serviceWorkers: 'block' });

test('opens a no-build diorama and places a locked item', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
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
          assets: [{ id: 't3:fixture/tree', path: 'tree.glb', url: assetUrl, sha256: 'fixture-hash' }],
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
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.game-frame canvas')).toBeVisible();
  await expect.poll(() => api.transactions.length, { timeout: 30_000 }).toBe(1);
  await expect(page.locator('.scenery-thumbnail img')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('scenery-palette.png') });
  await page.getByRole('button', { name: 'tree', exact: true }).click();
  const model = page.waitForResponse((response) => new URL(response.url()).pathname === assetUrl);
  await canvas.click({ position: { x: 180, y: 200 } });
  await expect.poll(() => api.transactions.length, { timeout: 30_000 }).toBe(2);
  expect((await model).ok()).toBe(true);
  await expect(page.locator('.game-frame canvas')).toHaveAttribute('data-scenery-items', '1');
  await expect(page.locator('.screen-error')).toHaveCount(0);
  expect(api.transactions[1]?.commands).toEqual([expect.objectContaining({ command: 'entity.create' })]);
  await page.getByRole('button', { name: 'Water', exact: true }).click();
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 100, bounds.y + 170);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 200, bounds.y + 230, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => api.transactions.length, { timeout: 30_000 }).toBe(3);
  expect(api.transactions[2]?.commands).toEqual([expect.objectContaining({ op: 'set', control: 'scenery.terrain' })]);
  await page.screenshot({ path: testInfo.outputPath('scenery-preview.png') });
});

test('shows a reviewed concept and sends scope placement to the builder', async ({ page }, testInfo) => {
  await installAuthRoutes(page, { signedIn: true });
  const api = await installGameApi(page);
  let request: { plan?: { summary?: string } } | undefined;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/games/game/branches/main/design')
      return route.fulfill({ json: { rev: 0, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } } });
    if (path === '/api/v1/games/game/previews') return route.fulfill({ json: { previews: [] } });
    if (path === '/api/v1/games/game/editor/stage')
      return route.fulfill({ json: { stage: { kind: 'image', url: '/concept-preview.svg' } } });
    if (path === '/api/v1/games/game/editor/fallback')
      return route.fulfill({
        json: {
          mode: 'request',
          palette: {
            categories: [{ id: 'scenery', label: 'Scenery', kind: 'items' }],
            items: [{ prefab: 'scope:0', label: 'Forest trees', category: 'scenery' }],
          },
        },
      });
    if (path === '/api/v1/jobs' && route.request().method() === 'POST') {
      request = route.request().postDataJSON() as typeof request;
      return route.fulfill({ status: 202, json: { jobId: 'job' } });
    }
    return route.fallback();
  });
  await page.route('**/concept-preview.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="forestgreen"/></svg>',
    }),
  );
  await page.goto('/g/game?mode=edit&test');
  await expect(page.locator('.game-frame img')).toBeVisible();
  await page.getByRole('button', { name: 'Forest trees' }).click();
  await page.getByLabel('Editor canvas').click({ position: { x: 180, y: 120 } });
  await expect.poll(() => request?.plan?.summary).toContain('scope:0');
  expect(api.transactions).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('concept-editor.png') });
});
