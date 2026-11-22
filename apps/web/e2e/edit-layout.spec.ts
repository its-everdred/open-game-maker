import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type Box = { x: number; y: number; width: number; height: number };

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

// Kevin's phone (#1199): the controls covered each other and the frame, and a fixed 50/50 split
// left a cream band under a wide frame. Each control must stay tappable and the frame must meet the chat.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  for (const orientation of ['Wide game', 'Vertical game'] as const) {
    test(`edit page controls clear the ${orientation.toLowerCase()} at ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
      await page.setViewportSize(viewport);
      await openEditor(page);
      await page.getByRole('button', { name: orientation }).click();
      const aspect = orientation === 'Wide game' ? 16 / 9 : 9 / 16;
      await expect.poll(async () => ratio(await box(page, '.game-stage'))).toBeCloseTo(aspect, 1);

      const parts = {
        orientation: await box(page, '[role="group"][aria-label="Game orientation"]'),
        play: await box(page, '.editor-play-button'),
        menu: await box(page, '.studio-menu-button'),
        editor: await box(page, 'summary[aria-label="Game editor"]'),
        frame: await box(page, '.game-stage'),
      };
      const names = Object.keys(parts) as (keyof typeof parts)[];
      for (const [i, a] of names.entries()) {
        for (const b of names.slice(i + 1)) {
          expect(intersects(parts[a], parts[b]), `${a} overlaps ${b}`).toBe(false);
        }
      }

      const frame = parts.frame;
      const chat = await box(page, '.edit-workspace-chat');
      const gap =
        viewport.width < viewport.height ? chat.y - (frame.y + frame.height) : frame.x - (chat.x + chat.width);
      expect(gap, 'gap between game frame and chat').toBeGreaterThanOrEqual(0);
      expect(gap, 'gap between game frame and chat').toBeLessThanOrEqual(8);

      await testInfo.attach(`edit-${viewport.width}x${viewport.height}-${orientation.split(' ')[0].toLowerCase()}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }
}

async function openEditor(page: Page) {
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.route('**/api/v1/me/commands**', (route) => route.fulfill({ json: { commands: [], sessions: [] } }));
  await page.route('**/api/v1/me/core-commands', (route) => route.fulfill({ json: { commands: [], targets: [] } }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: { platformRole: 'none' } }));
  await page.route('**/api/v1/me/executor/thread', (route) => route.fulfill({ status: 403, json: {} }));
  await page.route('**/api/v1/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/games/game/branches', (route) => route.fulfill({ json: { branches: [] } }));
  await page.route('**/api/v1/games', (route) => route.fulfill({ json: { games: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await page.goto('/g/game?mode=edit&test', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.edit-workspace')).toBeVisible();
}

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).boundingBox();
  expect(found, `${selector} is laid out`).not.toBeNull();
  return found!;
}

function ratio(b: Box) {
  return b.width / b.height;
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
