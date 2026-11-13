import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

test.use({ serviceWorkers: 'block' });

test('opens a no-build diorama and requests a locked item', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await installAuthRoutes(page, { signedIn: true });
  const api = await installGameApi(page);
  let request: { plan?: { summary?: string } } | undefined;
  const assetUrl = '/api/v1/games/game/scenery/assets/0/hash/tree.glb';
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/jobs' && route.request().method() === 'POST') {
      request = route.request().postDataJSON() as typeof request;
      return route.fulfill({ status: 202, json: { jobId: 'job' } });
    }
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
  await expect(page.locator('.scenery-thumbnail img')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('scenery-palette.png') });
  await page.getByRole('button', { name: 'tree', exact: true }).click();
  await canvas.click({ position: { x: 180, y: 200 } });
  await expect.poll(() => request?.plan?.summary, { timeout: 30_000 }).toContain('scenery:t3:fixture/tree');
  await expect(page.locator('.screen-error')).toHaveCount(0);
  expect(api.transactions).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('scenery-preview.png') });
});

test('keeps models and painted sprites together in a no-build scene', async ({ page }) => {
  test.setTimeout(180_000);
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  const assets = [
    { id: 'rock', path: 'rock.glb', sha256: 'a', url: '/api/v1/games/game/scenery/assets/0/a/rock.glb' },
    { id: 'forest', path: 'forest.png', sha256: 'b', url: '/api/v1/games/game/scenery/assets/1/b/forest.png' },
    { id: 'tree', path: 'tree.png', sha256: 'c', url: '/api/v1/games/game/scenery/assets/2/c/tree.png' },
  ];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/games/game/editor/previews') return route.fulfill({ json: { previews: [] } });
    if (path === '/api/v1/games/game/editor/stage') return route.fulfill({ json: { stage: null } });
    if (path === '/api/v1/games/game/branches')
      return route.fulfill({ json: [{ id: 'draft', name: 'draft', gameId: 'game' }] });
    if (path === '/api/v1/games/game/branches/draft/design')
      return route.fulfill({ json: { rev: 0, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } } });
    if (path === '/api/v1/games/game/scenery/source')
      return route.fulfill({
        json: {
          assets,
          scene: {
            version: 1,
            dimension: '3d',
            backdrop: {
              assetId: 'forest',
              landscape: { fit: 'cover', anchor: [0.5, 0.5] },
              portrait: { fit: 'cover', anchor: [0.5, 0.5] },
            },
            items: [
              {
                id: 'tree-1',
                assetId: 'tree',
                position: [200, 250, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
                layer: 'mid',
              },
            ],
            terrain: [],
            lighting: 'night',
            camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
          },
        },
      });
    if (path === assets[0]!.url)
      return route.fulfill({
        contentType: 'model/gltf-binary',
        body: readFileSync(new URL('../../../packages/sdk/test/fixtures/cube.meshopt.glb', import.meta.url)),
      });
    if (assets.slice(1).some((asset) => asset.url === path))
      return route.fulfill({
        contentType: 'image/png',
        body: readFileSync(new URL('../public/icons/favicon-32.png', import.meta.url)),
      });
    if (path.includes('/branches/draft/'))
      return route.fallback({ url: route.request().url().replace('/branches/draft/', '/branches/main/') });
    return route.fallback();
  });
  await page.goto('/g/game?mode=edit&test&v=draft');
  await expect(page.locator('.game-frame canvas')).toHaveAttribute('data-scenery-items', '0', { timeout: 30_000 });
  await expect(page.getByLabel('Scene items')).toContainText('tree');
  const canvas = page.getByLabel('Editor canvas');
  const bounds = (await canvas.boundingBox())!;
  const scale = Math.min(bounds.width / 640, bounds.height / 480);
  await canvas.click({
    position: { x: (bounds.width - 640 * scale) / 2 + 200 * scale, y: (bounds.height - 480 * scale) / 2 + 250 * scale },
  });
  await expect(page.getByRole('button', { name: 'Move scenery:tree', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rocks', exact: true }).click();
  await page.getByRole('button', { name: 'rock', exact: true }).click();
  await canvas.click({ position: { x: bounds.width * 0.75, y: bounds.height * 0.7 } });
  await expect(page.locator('.game-frame canvas')).toHaveAttribute('data-scenery-items', '1', { timeout: 30_000 });
  await expect(page.locator('.screen-error')).toHaveCount(0);
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
    if (path === '/api/v1/games/game/editor/previews') return route.fulfill({ json: { previews: [] } });
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
  await expect
    .poll(() => page.locator('.game-frame img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Forest trees' }).click();
  const canvas = page.getByLabel('Editor canvas');
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect.poll(() => request?.plan?.summary).toContain('scope:0');
  expect(api.transactions).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('concept-editor.png') });
});
