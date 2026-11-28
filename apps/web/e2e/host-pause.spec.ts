import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type GameHook = { bridgeState: string };
type FixtureHook = { send(t: string, payload: unknown): void };

// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '10001';
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;

test.use({ serviceWorkers: 'block' });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1180, height: 820 },
]) {
  test(`a game hides the Pause control on its own menus at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets each acceptance viewport itself');
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page);
    await openReadyGame(page);
    const pause = page.getByRole('button', { name: 'Menu' });
    await expect(pause).toBeVisible();

    await tellHost(page, false);
    await expect(pause).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath(`game-menu-${viewport.width}x${viewport.height}.png`),
      timeout: 90_000,
    });

    await tellHost(page, true);
    await expect(pause).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`play-${viewport.width}x${viewport.height}.png`),
      timeout: 90_000,
    });

    /* A reload must never strand the player on a hidden control. */
    await tellHost(page, false);
    await expect(pause).toBeHidden();
    await page.reload();
    await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');
    await signalFirstFrame(page);
    // Reload fires pagehide, so the away-pause safeguard requires an explicit resume.
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await paused.getByRole('button', { name: 'Resume' }).click();
    await expect(pause).toBeVisible();
  });
}

async function openReadyGame(page: Page): Promise<void> {
  await page.goto('/g/game?test');
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 30_000 }).toBe('ready');
  await signalFirstFrame(page);
}

async function signalFirstFrame(page: Page): Promise<void> {
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/d/`));
  if (!frame) throw new Error('game frame missing');
  await frame.evaluate(() => (window as Window & { __fixture: FixtureHook }).__fixture.send('load.frame', {}));
}

function gameState(page: Page): Promise<GameHook | undefined> {
  return page.evaluate(() => (window as Window & { __ogmHost?: { game?: GameHook } }).__ogmHost?.game);
}

async function tellHost(page: Page, visible: boolean): Promise<void> {
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/d/`));
  if (!frame) throw new Error('game frame missing');
  await frame.evaluate(
    (value) => (window as Window & { __fixture: FixtureHook }).__fixture.send('host.pause.visible', { visible: value }),
    visible,
  );
}
