import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';

type StubbedWindow = Window & { __tapSeen?: [number, number]; __ogmHost?: { get(name: string): unknown } };

const stub = readFileSync(new URL('./fixtures/town-stub/index.html', import.meta.url), 'utf8');
// a 1×1 PNG served as the poster; CSS stretches it full-bleed
const poster = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// eslint-disable-next-line no-restricted-properties
const configuredLogo = process.env.VITE_INSTANCE_LOGO_URL;
const testLogo =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#fb4934"/><text x="200" y="68" text-anchor="middle" font-size="54">TEST</text></svg>';

// the built town (tools/town.sh) is not in CI: serve the stub and a poster in its place
async function stubTown(page: Page) {
  await page.route('**/town/index.html*', (route) => route.fulfill({ contentType: 'text/html', body: stub }));
  await page.route('**/town/models/bake/poster-*', (route) =>
    route.fulfill({ contentType: 'image/png', body: poster }),
  );
}

test.use({ serviceWorkers: 'block' });

test.beforeEach(({ page }) => installAuthRoutes(page));

test('the server paints the poster before the app module loads', async ({ page }) => {
  await stubTown(page);
  let releaseApp!: () => void;
  const appHeld = new Promise<void>((resolve) => {
    releaseApp = resolve;
  });
  await page.route('**/assets/index-*.js', async (route) => {
    await appHeld;
    await route.continue();
  });

  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('#initial-title-poster img')).toBeVisible();
  } finally {
    releaseApp();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('title paints the poster first, then fades in the live town', async ({ page }) => {
  await stubTown(page);
  await page.goto('/?test', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.t-poster img')).toBeVisible();
  await expect(page.locator('.title-town')).toHaveClass(/\blive\b/, { timeout: 4000 });
  await expect(page.locator('.t-poster')).toHaveCount(0);
  const live = () => ((window as StubbedWindow).__ogmHost?.get('title') as { live(): boolean }).live();
  expect(await page.evaluate(live)).toBe(true);
});

test('title passes a tap on the town through to it', async ({ page }) => {
  await stubTown(page);
  await page.goto('/');
  await expect(page.locator('.title-town')).toHaveClass(/\blive\b/, { timeout: 4000 });

  const box = (await page.locator('.title-town').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect.poll(() => page.evaluate(() => (window as StubbedWindow).__tapSeen)).toEqual([0.5, 0.5]);
});

test('title Start is a primary-size target and the menu is labelled', async ({ page }) => {
  await stubTown(page);
  await page.goto('/');

  const start = page.getByRole('button', { name: 'Start', exact: true });
  const box = (await start.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(64);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/signin\?next=%2Fall$/);
  await expect(page.locator('.title-town iframe')).toHaveCount(0);
});

test('title only shows its thin aqua focus outline for keyboard input', async ({ page }) => {
  await stubTown(page);
  await page.goto('/');

  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeFocused();
  await expect(start).toHaveCSS('outline-style', 'none');

  await page.keyboard.press('Shift+Tab');
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeFocused();
  await expect(menu).toHaveCSS('outline-width', '2px');
  await expect(menu).toHaveCSS('outline-color', 'rgb(111, 214, 180)');

  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown')));
  await expect(menu).toHaveCSS('outline-style', 'none');
});

test('a configured logo uses the default title box without stretching', async ({ page }) => {
  test.skip(!configuredLogo, 'run with VITE_INSTANCE_LOGO_URL to exercise custom instance branding');
  await stubTown(page);
  await page.route(`**${configuredLogo}`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: testLogo }));
  await page.goto('/');

  const logo = page.getByRole('img', { name: 'Open Game Maker 2000' });
  await expect(logo).toHaveAttribute('src', configuredLogo!);
  const box = (await page.locator('.title-logo').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(1400 / 788, 2);
  await expect(logo).toHaveCSS('object-fit', 'contain');
});
