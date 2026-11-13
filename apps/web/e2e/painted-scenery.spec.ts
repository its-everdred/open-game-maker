import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

test.use({ serviceWorkers: 'block' });

test('edits a painted backdrop and its cut-out items', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await installAuthRoutes(page, { signedIn: true });
  const api = await installGameApi(page);
  const rule = { fit: 'cover', anchor: [0.5, 0.5] };
  const assets = ['forest', 'clearing', 'tree'].map((id, index) => ({
    id,
    path: `${id}.png`,
    sha256: `hash${index}`,
    url: `/api/v1/games/game/scenery/assets/${index}/hash/${id}.png`,
  }));
  assets.push({
    id: 'unused-model',
    path: 'unused.glb',
    sha256: 'hash3',
    url: '/api/v1/games/game/scenery/assets/3/hash/unused.glb',
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/games/game/branches/main/design')
      return route.fulfill({ json: { rev: 0, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } } });
    if (path === '/api/v1/games/game/scenery/source')
      return route.fulfill({
        json: {
          scene: {
            version: 1,
            dimension: '2d',
            backdrop: { assetId: 'forest', landscape: rule, portrait: rule },
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
            camera: { position: [0, 0, 1], target: [0, 0, 0], zoom: 1 },
          },
          assets,
        },
      });
    const asset = assets.find((entry) => entry.url === path);
    if (asset) {
      const svg =
        asset.id === 'tree'
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect x="35" y="55" width="10" height="45" fill="#69432c"/><circle cx="40" cy="38" r="35" fill="#225e35"/></svg>'
          : `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${asset.id === 'forest' ? '#90c878' : '#b8dce4'}"/><path d="M0 270 Q320 180 640 270 V360 H0Z" fill="#507a43"/></svg>`;
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    }
    return route.fallback();
  });
  await page.goto('/g/game?mode=edit&test');
  await expect(page.getByLabel('Scene items')).toContainText('forest', { timeout: 30_000 });
  await expect(page.locator('.game-frame canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('painted-before.png') });
  await page.getByRole('button', { name: 'clearing', exact: true }).click();
  await expect.poll(() => api.transactions.length).toBe(2);
  expect(api.transactions[1]?.commands).toEqual([expect.objectContaining({ op: 'set', control: 'scenery.backdrop' })]);
  await expect(page.getByLabel('Scene items')).toContainText('clearing');
  await page.screenshot({ path: testInfo.outputPath('painted-after.png') });
  const canvas = page.getByLabel('Editor canvas');
  const bounds = (await canvas.boundingBox())!;
  const scale = Math.min(bounds.width / 640, bounds.height / 480);
  const x = bounds.x + (bounds.width - 640 * scale) / 2 + 200 * scale;
  const y = bounds.y + (bounds.height - 480 * scale) / 2 + 250 * scale;
  await page.mouse.click(x, y);
  const handle = page.getByRole('button', { name: 'Move scenery:tree', exact: true });
  await expect(handle).toBeVisible();
  const handleBox = (await handle.boundingBox())!;
  const hx = handleBox.x + handleBox.width / 2,
    hy = handleBox.y + handleBox.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 30, hy + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => api.transactions.length, { timeout: 30_000 }).toBe(3);
  const moves = api.transactions[2]!.commands;
  expect(moves.length).toBeGreaterThan(0);
  expect(moves.at(-1)).toMatchObject({
    command: 'entity.transform',
    args: { pose: { position: [expect.any(Number), expect.any(Number), 0] } },
  });
  const last = moves.at(-1);
  if (last?.op !== 'invoke') throw new Error('expected a move command');
  const pose = last.args as { pose: { position: number[] } };
  expect(pose.pose.position[1]).toBeGreaterThan(250);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.poll(() => api.transactions.length, { timeout: 30_000 }).toBe(4);
  expect(api.transactions[3]?.commands).toEqual([expect.objectContaining({ command: 'entity.delete' })]);
});
