import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type GameHook = { bridgeState: string };
type FixtureHook = { messages: Array<{ t: string }> };

// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '10001';
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

const viewports = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
];

for (const viewport of viewports) {
  test(`play uses a full-screen game and one glass menu at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets each acceptance viewport itself');
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page);
    await openReadyGame(page);

    await expect(page.locator('.play-bar')).toHaveCount(0);
    await expect(page.locator('.platform-pause-slot')).toHaveCount(0);
    await expect(page.locator('.play-title')).toHaveCount(0);
    await expect(page.locator('.build-badge')).toHaveCount(0);
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-game-play', 'true');
    const glass = await menu.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backdropFilter: style.backdropFilter,
        backgroundImage: style.backgroundImage,
        borderTopWidth: style.borderTopWidth,
      };
    });
    expect(glass.backdropFilter).not.toBe('none');
    expect(glass.backgroundImage).toContain('gradient');
    expect(glass.borderTopWidth).toBe('1px');

    const gameBox = await page.locator('.game-frame iframe').boundingBox();
    expect(gameBox).not.toBeNull();
    expect(gameBox?.x).toBe(0);
    expect(gameBox?.y).toBe(0);
    expect(gameBox?.width).toBe(viewport.width);
    expect(gameBox?.height).toBe(viewport.height);
    await page.screenshot({
      path: testInfo.outputPath(`play-${viewport.width}x${viewport.height}.png`),
      timeout: 30_000,
    });

    await menu.click();
    const menuRow = page.getByRole('group', { name: 'Menu' });
    for (const name of ['Games', 'Edit', 'Ask for a change', 'Invite', 'Versions']) {
      await expect(menuRow.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expectMenuSlotsNotToOverlap(menuRow);
    if (viewport.width === 844) {
      const buttons = menuRow.locator('button, a');
      expect(await buttons.count()).toBeGreaterThan(10);
      for (const button of await buttons.all()) {
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(640);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      await menuRow.evaluate((element) => {
        element.scrollTop = 0;
      });
      await menuRow.getByRole('button', { name: 'Report a problem' }).click();
      const report = page.getByRole('form', { name: 'Report a problem' });
      await expect(report.getByRole('textbox', { name: 'What went wrong?' })).toBeInViewport({ ratio: 1 });
      await report.getByRole('button', { name: 'Close' }).click();
    }
    await expect.poll(() => fixtureMessages(page)).toContain('lifecycle.pause');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`menu-${viewport.width}x${viewport.height}.png`),
      timeout: 30_000,
    });

    const pauseDialog = page.getByRole('dialog', { name: 'Paused' });
    await pauseDialog.getByRole('button', { name: 'Credits' }).click();
    await expect(page.getByRole('dialog', { name: 'Credits' })).toBeVisible();
    await expect(menuRow).toBeVisible();
    expect(await fixtureMessages(page)).not.toContain('lifecycle.resume');
    await page.getByRole('dialog', { name: 'Credits' }).getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();

    // The short-landscape case covers the play menu; the other sizes exercise the editor round trip.
    if (viewport.width === 844) return;

    await menuRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/mode=edit/);
    await expect.poll(() => fixtureMessages(page)).toContain('lifecycle.resume');
    await page.screenshot({
      path: testInfo.outputPath(`edit-${viewport.width}x${viewport.height}.png`),
      timeout: 30_000,
    });

    await page.getByRole('button', { name: /Play/ }).click();
    await expect(page.locator('.play-bar')).toHaveCount(0);
  });
}

test('opening the menu in a room does not pause the game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop covers the room lifecycle rule');
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.goto('/g/game?room=room-1&test');
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');

  await page.getByRole('button', { name: 'Menu' }).click({ force: true });
  await expect(page.getByRole('group', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
  expect(await fixtureMessages(page)).not.toContain('lifecycle.pause');
});

async function openReadyGame(page: Page): Promise<void> {
  await page.goto('/g/game?test');
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');
}

function gameState(page: Page): Promise<GameHook | undefined> {
  return page.evaluate(() => (window as Window & { __ogmHost?: { game?: GameHook } }).__ogmHost?.game);
}

async function fixtureMessages(page: Page): Promise<string[]> {
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/g/`));
  if (!frame || frame.isDetached()) return [];
  try {
    return await frame.evaluate(() =>
      (window as Window & { __fixture: FixtureHook }).__fixture.messages.map(({ t }) => t),
    );
  } catch {
    return [];
  }
}

async function expectMenuSlotsNotToOverlap(menuRow: ReturnType<Page['locator']>): Promise<void> {
  await menuRow.locator('.studio-menu-slot').evaluateAll(async (elements) => {
    await Promise.all(elements.flatMap((element) => element.getAnimations().map((animation) => animation.finished)));
  });
  const boxes = await menuRow.locator('.studio-menu-slot').evaluateAll((elements) =>
    elements
      .map((element) => element.getBoundingClientRect())
      .filter(({ width, height }) => width > 0 && height > 0)
      .map(({ x, y, width, height }) => ({ x, y, width, height })),
  );
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!;
      const b = boxes[right]!;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `menu slots ${left} and ${right} overlap`).toBe(false);
    }
  }
}
