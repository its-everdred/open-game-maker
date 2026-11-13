import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test('renders prototype showcase art and opens a detail sheet', async ({ page }) => {
  test.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/proto/scenes.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const ready = Promise.resolve(); export const SCENES = { restorebound: { cover: [0, 0] } }; export function paint(canvas) { canvas.width = 320; canvas.height = 180; canvas.getContext('2d').fillRect(0, 0, 320, 180); }`,
    }),
  );
  await page.goto('/all?test');
  const tile = page.getByRole('button', { name: /^RestoreBound:/ });
  if (test.info().project.name === 'phone') {
    const first = page.getByRole('button', { name: /^Goblin Cellar:/ });
    const [firstBox, nextBox] = await Promise.all([first.boundingBox(), tile.boundingBox()]);
    expect(firstBox).not.toBeNull();
    expect(nextBox!.y).toBeGreaterThan(firstBox!.y);
  }
  await expect(tile.locator('canvas')).toHaveAttribute('data-painted', 'true');
  await tile.click();
  await expect(page.getByRole('heading', { name: 'RestoreBound' })).toBeVisible();
  await expect(page.getByText('A sleepy village, one repair at a time.')).toBeVisible();
  await page.getByRole('button', { name: 'Play RestoreBound' }).click();
  await expect(page).toHaveURL(/\/g\/showcase\/restorebound\?mode=play/);
});
