import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type GameHook = { bridgeState: string };
type FixtureHook = { messages: Array<{ t: string }>; send(type: string, payload: object): void };

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
    test.setTimeout(300_000);
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
      timeout: 120_000,
    });

    await menu.click();
    const pauseDialog = page.getByRole('dialog', { name: 'Paused' });
    await expect(pauseDialog).toBeVisible();
    await expect.poll(() => fixtureMessages(page)).toContain('lifecycle.pause');
    // Kevin, 2026-11-18: the studio circles sprayed over the pause panel. Pause shows one panel and nothing on top.
    await expect(page.getByRole('group', { name: 'Menu' })).toBeHidden();
    // Kevin, 2026-11-24 (#1326): Resume, Restart, Leave, sound and File a bug; Settings, Edit and More stay quiet circles.
    for (const name of ['Resume', 'Restart', 'Leave', 'Mute', 'File a bug', 'Settings', 'Edit', 'More']) {
      await expect(pauseDialog.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(pauseDialog).toBeInViewport({ ratio: 1 });
    for (const name of ['Mute', 'Settings', 'Edit', 'More']) {
      const box = await pauseDialog.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.width).toBe(48);
      expect(box?.height).toBe(48);
    }
    await page.screenshot({
      path: testInfo.outputPath(`menu-${viewport.width}x${viewport.height}.png`),
      timeout: 120_000,
    });

    await pauseDialog.getByRole('button', { name: 'More' }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    const menuRow = more.getByRole('group', { name: 'Menu' });
    // Play mode carries no tickets or agent context (#1326): More holds only the game's own extras.
    await expect(menuRow.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
    for (const name of ['Games', 'Edit', 'Ask for a change', 'Report a problem']) {
      await expect(menuRow.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await page.screenshot({
      path: testInfo.outputPath(`more-${viewport.width}x${viewport.height}.png`),
      timeout: 120_000,
    });
    expect(await fixtureMessages(page)).not.toContain('lifecycle.resume');
    await more.getByRole('button', { name: 'Back' }).click();
    await expect(pauseDialog).toBeVisible();
    await expect(page.getByRole('group', { name: 'Menu' })).toBeHidden();

    // The short-landscape case covers the play menu; the other sizes exercise the editor round trip.
    if (viewport.width === 844) return;

    await pauseDialog.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/mode=edit/);
    await expect.poll(() => fixtureMessages(page)).toContain('lifecycle.resume');
    await page.screenshot({
      path: testInfo.outputPath(`edit-${viewport.width}x${viewport.height}.png`),
      timeout: 120_000,
    });

    await page.getByRole('button', { name: /Play/ }).click();
    await expect(page.locator('.play-bar')).toHaveCount(0);
  });
}

test('play menu stays readable over light artwork', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop covers the shared glass styling');
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await openReadyGame(page);
  const menu = page.getByRole('button', { name: 'Menu' });
  // Over white artwork the pale icon must stay readable.
  const contrast = await menu.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const luminance = (colour: string, background: string) => {
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const background = luminance(style.backgroundColor, 'white');
    const foreground = luminance(style.color, 'white');
    return (foreground + 0.05) / (background + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('settings holds credits and keeps the game menu hidden until returning to pause', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop covers the shared menu interaction');
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await openReadyGame(page);
  await page.getByRole('button', { name: 'Menu' }).click({ force: true });
  const menuRow = page.getByRole('group', { name: 'Menu' });
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(menuRow).toBeHidden();
  await expect(settings.locator('summary').filter({ hasText: 'Sound' })).toHaveCSS('list-style-type', 'none');
  await settings.locator('summary').filter({ hasText: 'Credits' }).click();
  await expect(
    settings.getByText('Loading…').or(settings.locator('.credits-list, [role="alert"]')).first(),
  ).toBeVisible();
  await settings.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await expect(menuRow).toBeHidden();
});

test('opening the menu in a room does not pause the game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop covers the room lifecycle rule');
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.goto('/g/game?room=room-1&test');
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');

  await page.getByRole('button', { name: 'Menu' }).click({ force: true });
  const gameMenu = page.getByRole('dialog', { name: 'Game menu' });
  await expect(gameMenu).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
  await expect(gameMenu.getByRole('button', { name: 'Restart' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Menu' })).toBeHidden();
  expect(await fixtureMessages(page)).not.toContain('lifecycle.pause');
});

async function openReadyGame(page: Page): Promise<void> {
  await page.goto('/g/game?test');
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/g/`));
  if (!frame) throw new Error('Bridge fixture frame is missing');
  await frame.evaluate(() => (window as Window & { __fixture: FixtureHook }).__fixture.send('load.frame', {}));
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
