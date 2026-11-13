import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test('renders prototype showcase art and opens a detail sheet', async ({ page }) => {
  test.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.goto('/all?test');
  const logo = page.getByRole('link', { name: 'Open Game Maker 2000' }).locator('img');
  await expect(logo).toHaveAttribute('src', '/proto/art/gm.webp');
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const tile = page.getByRole('button', { name: /^RestoreBound:/ });
  if (test.info().project.name === 'phone') {
    const first = page.getByRole('button', { name: /^Goblin Cellar:/ });
    const [firstBox, nextBox] = await Promise.all([first.boundingBox(), tile.boundingBox()]);
    expect(firstBox).not.toBeNull();
    expect(nextBox!.y).toBeGreaterThan(firstBox!.y);
  }
  await expect(tile.locator('canvas')).toHaveAttribute('data-painted', 'true');
  const colours = await tile.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const values = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4) values.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return values.size;
  });
  expect(colours).toBeGreaterThan(20);
  await tile.click();
  await expect(page.getByRole('heading', { name: 'RestoreBound' })).toBeVisible();
  await expect(page.locator('.games-spotlight-media canvas')).toHaveAttribute('data-painted', 'true');
  await expect(page.locator('.games-spotlight-media')).toHaveAttribute('data-splat', 'true');
  await expect(page.getByText('A sleepy village, one repair at a time.')).toBeVisible();
  await page.getByRole('button', { name: 'Play RestoreBound' }).click();
  await expect(page).toHaveURL(/\/g\/showcase\/restorebound\?mode=play/);
});
