import { expect, test, type Frame, type Page } from '@playwright/test';

import { emptyScene } from '@ogm/design-log';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';
import { bridgeOrigin } from './support/visibility';

type Box = { x: number; y: number; width: number; height: number };
type Fixture = { send(t: string, payload: unknown): void; hd2d: { doc: Doc; weather?: string }[] };
type Doc = { lighting: { shafts?: { intensity: number; count?: number; when?: { weather?: string[] } } } };

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

/** Dusk Helm's forest look: short shafts that come and go, only in clear or partly cloudy weather (#1149). */
const forest = {
  version: 1,
  lighting: {
    ambient: { color: '#ffc982', intensity: 0.85 },
    grade: { temperature: 0.6, saturation: 1.1, contrast: 1.08 },
    shafts: {
      direction: 1.1,
      color: '#ffb04a',
      intensity: 0.65,
      count: 5,
      reach: 0.45,
      width: 0.05,
      pool: 1,
      cycle: 8,
      chance: 0.8,
      when: { biomes: ['forest'], weather: ['clear', 'partly-cloudy'] },
    },
    clouds: { coverage: 0.45, scale: 0.55, speed: 0.015, direction: 0.3, shadow: 0.5, sun: 0.4 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.2 },
    lights: [
      {
        id: 'campfire',
        x: 0,
        y: 0,
        radius: 260,
        color: '#ff9a3c',
        intensity: 0.7,
        flicker: { amount: 0.3, rate: 7, seed: 3 },
      },
    ],
  },
  focus: { mode: 'depthBands', target: 'player', smoothing: 0.15, strength: 0.6, range: 0.25, hero: 'hero' },
  atmosphere: {},
  particles: {
    emitters: [
      { preset: 'forest-leaves', at: [0, 4, 0] },
      { preset: 'soft-motes', at: [0, 2, 0] },
    ],
    wind: { direction: [1, -0.25, 0.3], strength: 1.2, seed: 3 },
  },
};

// Kevin tunes lighting himself in the editor (2026-11-22): every change has to reach the running game, live.
test('the lighting panel edits the running scene through the game frame', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
  await page.setViewportSize({ width: 390, height: 844 });
  const game = await openEditor(page);
  await expect(page.getByRole('button', { name: 'Lighting' })).toHaveCount(0);
  await game.evaluate((doc) => fixture().send('hd2d.scene', { doc, biome: 'forest', weather: 'clear' }), forest);

  await page.getByRole('button', { name: 'Lighting' }).click();
  await page.getByRole('slider', { name: 'Brightness' }).fill('0.3');
  await page.getByRole('slider', { name: 'Beams' }).fill('2');
  await expect
    .poll(() => lastApply(game))
    .toMatchObject({ doc: { lighting: { shafts: { intensity: 0.3, count: 2 } } } });

  await page.getByRole('tab', { name: 'Weather' }).click();
  await page.getByRole('group', { name: 'Preview' }).getByRole('button', { name: 'Rain' }).click();
  await expect.poll(() => lastApply(game)).toMatchObject({ weather: 'rain' });
  await page.getByRole('group', { name: 'Shafts in' }).getByRole('button', { name: 'Rain' }).click();
  await expect
    .poll(async () => (await lastApply(game))?.doc.lighting.shafts?.when?.weather)
    .toEqual(['clear', 'partly-cloudy', 'rain']);
  /* The game's echo of each edit never pulls the controls back. */
  await page.getByRole('tab', { name: 'Sun shafts' }).click();
  await expect(page.getByRole('slider', { name: 'Brightness' })).toHaveValue('0.3');
});

// The map maker covers the game while a scene document is open (#1209): lighting edits there would be unseen.
test('the lighting panel hides while the map maker covers the game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const game = await openEditor(page, '&scene=goblin-cave', () =>
    page.route('**/api/v1/games/game/editor/scenes/goblin-cave', async (route) => {
      await held;
      await route.fulfill({
        json: { rev: 1, doc: emptyScene('game', 'goblin-cave', 'smallscaleint'), author: 'agent', sprites: {} },
      });
    }),
  );
  await game.evaluate((doc) => fixture().send('hd2d.scene', { doc, biome: 'forest', weather: 'clear' }), forest);
  await expect(page.getByRole('button', { name: 'Lighting' })).toBeVisible();

  release();
  await expect(page.getByLabel('Map', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lighting' })).toHaveCount(0);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
]) {
  test(`the lighting panel stays clear of the edit controls at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
    await page.setViewportSize(viewport);
    const game = await openEditor(page);
    await game.evaluate((doc) => fixture().send('hd2d.scene', { doc, biome: 'forest', weather: 'clear' }), forest);
    await page.getByRole('button', { name: 'Lighting' }).click();
    const parts = {
      toggle: await box(page, '.hd2d-toggle'),
      panel: await box(page, '.hd2d-panel'),
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
    for (const tab of ['Sun shafts', 'Light']) {
      await page.getByRole('tab', { name: tab }).click();
      await testInfo.attach(`lighting-${tab.replace(' ', '-').toLowerCase()}-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  });
}

/* Runs in the game frame. */
declare function fixture(): Fixture;

/** `routes` go in after the defaults, so they answer first. */
async function openEditor(page: Page, query = '', routes?: () => Promise<void>): Promise<Frame> {
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
  await routes?.();
  await page.goto(`/g/game?mode=edit&test${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.edit-workspace')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as { __ogmHost?: { game?: { bridgeState?: string } } }).__ogmHost?.game?.bridgeState,
        ),
      { timeout: 30_000 },
    )
    .toBe('ready');
  const game = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/g/`))!;
  await game.evaluate(() => {
    Object.assign(window, { fixture: () => (window as unknown as { __fixture: Fixture }).__fixture });
  });
  return game;
}

function lastApply(game: Frame) {
  return game.evaluate(() => fixture().hd2d.at(-1));
}

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).boundingBox();
  expect(found, `${selector} is laid out`).not.toBeNull();
  return found!;
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
