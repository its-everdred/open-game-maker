import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type Box = { x: number; y: number; width: number; height: number };

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

// Kevin's phone (#1199): the controls covered each other and the frame. #1269: no orientation buttons.
// #1295: the preview fills the page under the top bar at every shape, and the chat waits behind a bottom-right bubble.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
]) {
  test(`edit preview fills the page and the chat opens from its bubble at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
    await page.setViewportSize(viewport);
    await openEditor(page);
    await expect(page.getByRole('group', { name: 'Game orientation' })).toHaveCount(0);
    await expect(page.locator('.edit-workspace-chat')).toBeHidden();

    const frame = await box(page, '.game-stage');
    expect(frame.width, 'preview width').toBeGreaterThanOrEqual(viewport.width - 1);
    expect(frame.y + frame.height, 'preview reaches the bottom').toBeGreaterThanOrEqual(viewport.height - 1);
    expect(frame.y, 'preview starts under the top bar').toBeLessThanOrEqual(100);

    const parts = {
      play: await box(page, '.editor-play-button'),
      menu: await box(page, '.studio-menu-button'),
      editor: await box(page, 'summary[aria-label="Game editor"]'),
      chat: await box(page, '.edit-workspace-chat-bubble'),
    };
    const names = Object.keys(parts) as (keyof typeof parts)[];
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        expect(intersects(parts[a], parts[b]), `${a} overlaps ${b}`).toBe(false);
      }
    }
    expect(parts.chat.x + parts.chat.width, 'bubble at the right').toBeGreaterThan(viewport.width - 80);
    expect(parts.chat.y + parts.chat.height, 'bubble at the bottom').toBeGreaterThan(viewport.height - 80);
    await testInfo.attach(`edit-closed-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.getByRole('button', { name: 'Chat' }).click();
    const sheet = await box(page, '.edit-workspace-chat');
    await expect(page.locator('.edit-workspace-chat aiur-composer')).toBeVisible();
    expect(sheet.y + sheet.height, 'sheet sits on the bottom').toBeGreaterThanOrEqual(viewport.height - 1);
    expect(intersects(sheet, await box(page, '.edit-workspace-chat-bubble')), 'bubble clear of the sheet').toBe(false);
    await testInfo.attach(`edit-open-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Chat' }).click();
    await expect(page.locator('.edit-workspace-chat')).toBeHidden();
  });
}

test('turning the phone turns the edit preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  const portrait = await box(page, '.game-stage');
  expect(ratio(portrait)).toBeLessThan(1);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => ratio(await box(page, '.game-stage'))).toBeGreaterThan(1);
});

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
