import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';

test('opens the signed-in ticket workspace in an isolated frame at the requested scenario', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/games/resolve/demo')
      return route.fulfill({ json: { game: { id: 'g_demo', slug: 'demo', title: 'Demo' } } });
    if (path === '/api/v1/games/g_demo/live/12')
      return route.fulfill({
        json: {
          gameId: 'g_demo',
          accessId: 'pv-11111111-1111-1111-1111-111111111111',
          version: '22222222-2222-2222-2222-222222222222',
          design: { rev: 0, doc: { schemaVersion: 1, globals: {}, entities: {} } },
        },
      });
    return route.fulfill({ status: 404, json: { error: 'not_mocked' } });
  });
  await page.route('**/l/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Live fixture</title>' }),
  );
  await page.goto('/live/demo/12?scenario=yard');
  const frame = page.locator('iframe[title="Game"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-pointer-lock');
  await expect(frame).toHaveAttribute(
    'src',
    /\/l\/g_demo\/pv-11111111-1111-1111-1111-111111111111\/22222222-2222-2222-2222-222222222222\/index\.html\?.*scenario=yard/,
  );
});
