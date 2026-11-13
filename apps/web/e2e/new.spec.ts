import { writeFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installNewRoutes } from './fixtures/new-routes';

type NewGameTestApi = {
  step: string;
  picks: Record<string, { picks?: string[] } | undefined>;
  sessionId?: string;
};

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('phone multi-pick announces capacity and shows the prototype limit', async ({ page, isMobile }, testInfo) => {
  testInfo.setTimeout(90_000);
  test.skip(!isMobile, 'phone screenshot acceptance path');
  await installAuthRoutes(page, { signedIn: true, github: 'kim' });
  await installNewRoutes(page);
  const adventure = await openReadyNewGame(page);
  const capacity = page.locator('.new-pick-capacity');

  await expect(capacity).toBeAttached();
  await expect(capacity).toHaveAccessibleName('0 of 3 picked');
  await expect(page.getByText('Pick up to 3')).toBeVisible();
  await attachScreenshot(page, testInfo, 'pick-capacity-0');

  await selectOption(page, adventure, 'genre', 'adventure');
  await selectOption(page, page.getByRole('button', { name: 'RPG' }), 'genre', 'rpg');
  await expect(capacity).toHaveAccessibleName('2 of 3 picked');
  await attachScreenshot(page, testInfo, 'pick-capacity-2');

  await selectOption(page, page.getByRole('button', { name: 'Puzzle' }), 'genre', 'puzzle');
  await expect(capacity).toHaveAccessibleName('3 of 3 picked');
  await attachScreenshot(page, testInfo, 'pick-capacity-3');

  const sports = page.getByRole('button', { name: 'Sports' });
  const overflowFeedback = await sports.evaluate(async (button) => {
    button.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const selected = Array.from(document.querySelectorAll<HTMLButtonElement>('.new-option[aria-pressed="true"]'));

    return {
      rejectedPressed: button.getAttribute('aria-pressed'),
      selectedCount: selected.length,
      selectedShakeCount: selected.filter((tile) => tile.classList.contains('new-limit-shake')).length,
      animationName: selected[0] ? getComputedStyle(selected[0]).animationName : '',
    };
  });

  expect(overflowFeedback).toEqual({
    rejectedPressed: 'false',
    selectedCount: 3,
    selectedShakeCount: 3,
    animationName: 'new-limit-pulse-a',
  });
});

test('phone creation flow reaches scope admission and queues at reset', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone acceptance path');
  await installAuthRoutes(page, { signedIn: true, github: 'kim' });
  const routes = await installNewRoutes(page);
  const adventure = await openReadyNewGame(page);

  const tile = await adventure.boundingBox();
  expect(tile!.width).toBeGreaterThanOrEqual(64);
  expect(tile!.height).toBeGreaterThanOrEqual(64);
  await selectOption(page, adventure, 'genre', 'adventure');
  await activate(page, 'Next');

  await activate(page, 'Other');
  await activate(page, 'Type it');
  await page.getByRole('textbox', { name: 'Your own vibe' }).fill('Moonlit');
  await activate(page, 'Add');
  await expect(page.getByText('“Moonlit”')).toBeVisible();
  await activate(page, 'Next');

  await expect(page.getByRole('button', { name: 'Pixel art' })).toBeVisible();
  await expect(page.getByText('SmallScaleInt')).toHaveCount(0);
  await activate(page, 'Pixel art');
  await activate(page, 'SmallScaleInt');
  await expect(page.getByText('SmallScaleInt')).toHaveCount(0);
  await expect(page.getByText('Portal glade ambush')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Portal glade ambush' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Outline options' })).toBeVisible();
  // Browser coverage stays on GIF fallbacks; the component spec owns video playback and synchronization.
  await expect(page.locator('.new-style-detail video')).toHaveCount(0);
  await expect(page.locator('.new-style-detail canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous style' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next style' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous scene' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next scene' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.new-style-detail img')
        .evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0)),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.locator('.new-style-track').evaluateAll((tracks) => {
        const viewportWidth = document.documentElement.clientWidth;
        return tracks.every((track) => {
          const box = track.getBoundingClientRect();
          return Math.abs(box.width - viewportWidth) <= 1;
        });
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
  await activate(page, 'Select SmallScaleInt');
  await expect.poll(() => newGameState(page).then((state) => state?.picks.family?.picks)).toContain('smallscaleint');
  await activate(page, 'Next');
  await selectOption(page, page.getByRole('button', { name: 'Sky islands' }), 'world', 'sky');
  await activate(page, 'Next');
  await selectOption(page, page.getByRole('button', { name: 'Solo' }), 'players', 'single');
  await activate(page, 'Next');

  await expect(page.getByText('“Moonlit”')).toBeVisible();
  await expect(page.getByText('Three small islands will make a good first version.')).toBeVisible();
  expect(routes.scopeRequests[0]).toMatchObject({ choices: { family: 'smallscaleint', pov: 'iso' } });
  await page.getByRole('textbox', { name: 'Message the builder' }).fill('Keep the first version small.');
  await activate(page, 'Send');
  await expect(page.getByText('Keep the first version small.')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Finish' })).toBeEnabled({ timeout: 5_000 });

  const testApi = await page.evaluate(() => {
    const api = window.__ogmHost?.get('new') as NewGameTestApi;
    return { step: api.step, picks: api.picks, sessionId: api.sessionId };
  });
  expect(testApi.step).toBe('talk');
  expect(testApi.picks).toMatchObject({ genre: { picks: ['adventure'] }, family: { picks: ['smallscaleint'] } });
  expect(testApi.sessionId).toBeTruthy();

  await activate(page, 'Finish');
  await activate(page, 'Queue for the reset');
  await expect(page).toHaveURL(/\/all\?spotlight=g_/, { timeout: 5_000 });
  expect(routes.scopeMessages).toEqual(['Keep the first version small.']);
  expect(routes.admissions).toHaveLength(2);
  expect(routes.admissions[0]).toMatchObject({ start: 'now', idempotencyKey: expect.stringMatching(/:1$/) });
  expect(routes.admissions[1]).toMatchObject({ start: 'at_reset', idempotencyKey: expect.stringMatching(/:2$/) });
});

test('style detail fits its media and navigation into phone and desktop viewports', async ({ page }) => {
  test.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true, github: 'kim' });
  await installNewRoutes(page);

  const viewports = [
    { width: 390, height: 844 },
    { width: 390, height: 640 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 1280, height: 720 },
  ];
  for (const [index, viewport] of viewports.entries()) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/new?test&step=family', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__ogmHost?.get('new') !== undefined);
      if (index === 0) {
        const familyIcons = page.locator('[data-style-family] .new-option-icon svg');
        await expect(familyIcons).toHaveCount(5);
        expect(
          await familyIcons.evaluateAll((icons) => icons.every((icon) => icon.getBoundingClientRect().width > 0)),
        ).toBe(true);
      }
      await page.getByRole('button', { name: 'Isometric' }).dispatchEvent('click');
      await page.locator('.new-style-detail').waitFor({ state: 'attached' });
      if (viewport.width <= 600)
        await expect
          .poll(() =>
            page.locator('.new-game-screen').evaluate((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                width: Math.round(box.width),
                paddingTop: style.paddingTop,
                paddingBottom: style.paddingBottom,
              };
            }),
          )
          .toEqual({ width: viewport.width, paddingTop: '0px', paddingBottom: '0px' });

      const controls = page.locator(
        'button[aria-label="Previous scene"], button[aria-label="Next scene"], button[aria-label="Previous style"], button[aria-label="Next style"], button.new-style-select',
      );
      const tracks = page.locator('.new-style-track');
      const stopRow = page.locator('.new-style-stops');

      await expect(controls).toHaveCount(5);
      await expect(tracks).toHaveCount(2);
      await expect(stopRow).toHaveCount(1);
      await expect
        .poll(
          () =>
            tracks.first().evaluate((element) => {
              const box = element.getBoundingClientRect();
              return box.bottom <= window.innerHeight && box.right <= window.innerWidth;
            }),
          { message: `style media settled at ${viewport.width}x${viewport.height}` },
        )
        .toBe(true);
      const boxesFor = (elements: Element[]) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.getAttribute('aria-label') ?? element.className,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
            inViewport:
              box.width > 0 &&
              box.height > 0 &&
              box.top >= 0 &&
              box.left >= 0 &&
              box.bottom <= window.innerHeight &&
              box.right <= window.innerWidth,
          };
        });
      const [controlBoxes, trackBoxes, stopRowBoxes, layoutBoxes] = await Promise.all([
        controls.evaluateAll(boxesFor),
        tracks.evaluateAll(boxesFor),
        stopRow.evaluateAll(boxesFor),
        page
          .locator('.new-game-screen, .new-game-body, .new-style-step, .new-style-detail, .new-style-showcase-detail')
          .evaluateAll(boxesFor),
      ]);
      const screenStyle = await page.locator('.new-game-screen').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          gridTemplateRows: style.gridTemplateRows,
          matchesDetail: element.matches(':has(.new-style-detail)'),
        };
      });
      const [diorama, sheet] = trackBoxes;

      expect(controlBoxes).toHaveLength(5);
      expect(trackBoxes).toHaveLength(2);
      expect(stopRowBoxes).toHaveLength(1);
      const measuredBoxes = [...controlBoxes, ...trackBoxes, ...stopRowBoxes];
      expect(
        measuredBoxes.every(({ inViewport }) => inViewport),
        `viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(measuredBoxes)} layout=${JSON.stringify(layoutBoxes)}`,
      ).toBe(true);
      expect(Math.abs(diorama!.width - sheet!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(diorama!.height - sheet!.height)).toBeLessThanOrEqual(1);
      const styleArrowBoxes = controlBoxes.filter(({ name }) => name === 'Previous style' || name === 'Next style');
      if (viewport.width <= 600) {
        expect(
          diorama!.bottom,
          `viewport ${viewport.width}x${viewport.height}: tracks=${JSON.stringify(trackBoxes)} layout=${JSON.stringify(layoutBoxes)} screen=${JSON.stringify(screenStyle)}`,
        ).toBeLessThanOrEqual(sheet!.top);
        expect(
          styleArrowBoxes.every((box) => Math.abs(box.top + box.height / 2 - (diorama.top + diorama.height / 2)) <= 1),
        ).toBe(true);
        expect(styleArrowBoxes.every((box) => box.left >= diorama!.left && box.right <= diorama!.right)).toBe(true);
        expect(styleArrowBoxes[0]!.left).toBeLessThan(diorama!.left + diorama!.width / 4);
        expect(styleArrowBoxes[1]!.right).toBeGreaterThan(diorama!.right - diorama!.width / 4);
        expect(styleArrowBoxes.every((box) => box.width >= 44 && box.height >= 44)).toBe(true);
        expect(
          diorama!.width,
          `viewport ${viewport.width}x${viewport.height}: tracks=${JSON.stringify(trackBoxes)} layout=${JSON.stringify(layoutBoxes)} screen=${JSON.stringify(screenStyle)}`,
        ).toBeGreaterThanOrEqual(viewport.width - 1);
      } else {
        expect(Math.abs(diorama!.width - diorama!.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(sheet!.width - sheet!.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(diorama!.top - sheet!.top)).toBeLessThanOrEqual(1);
      }
      expect(
        Math.max(diorama!.bottom, sheet!.bottom),
        `viewport ${viewport.width}x${viewport.height}: tracks=${JSON.stringify(trackBoxes)} stops=${JSON.stringify(stopRowBoxes)} layout=${JSON.stringify(layoutBoxes)}`,
      ).toBeLessThanOrEqual(stopRowBoxes[0]!.top);
    });
  }

  await expect(page.getByRole('button', { name: /^Back to / })).toHaveCount(0);
  await expect(page.locator('.new-style-detail h2, .new-style-stop span, .new-style-set span')).toHaveCount(0);

  const [sceneArrowBackground, styleArrowBackground] = await Promise.all([
    page.getByRole('button', { name: 'Previous scene' }).evaluate((button) => getComputedStyle(button).backgroundColor),
    page.getByRole('button', { name: 'Previous style' }).evaluate((button) => getComputedStyle(button).backgroundColor),
  ]);
  expect(sceneArrowBackground).not.toBe(styleArrowBackground);

  await test.step('390x640 embedding frame', async () => {
    await page.setViewportSize({ width: 800, height: 720 });
    await page.setContent(
      '<iframe title="Embedded creation" src="/new?test&step=family" style="width:390px;height:640px;border:0"></iframe>',
    );
    const embedded = page.frameLocator('iframe[title="Embedded creation"]');
    await embedded.getByRole('button', { name: 'Isometric' }).dispatchEvent('click');
    const tracks = embedded.locator('.new-style-track');
    const stops = embedded.locator('.new-style-stops');
    const arrows = embedded.locator('button[aria-label="Previous style"], button[aria-label="Next style"]');
    await expect(tracks).toHaveCount(2);

    const [trackBoxes, stopBox, arrowBoxes, selectBox, detailBox] = await Promise.all([
      tracks.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON())),
      stops.evaluate((element) => element.getBoundingClientRect().toJSON()),
      arrows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON())),
      embedded
        .getByRole('button', { name: 'Select SmallScaleInt' })
        .evaluate((element) => element.getBoundingClientRect().toJSON()),
      embedded.locator('.new-style-detail').evaluate((element) => element.getBoundingClientRect().toJSON()),
    ]);
    const [diorama, sheet] = trackBoxes;

    expect(diorama!.width).toBeGreaterThan(0);
    expect(diorama!.bottom).toBeLessThanOrEqual(sheet!.top);
    expect(sheet!.bottom).toBeLessThanOrEqual(stopBox.top);
    expect(stopBox.bottom).toBeLessThanOrEqual(detailBox.bottom);
    expect(selectBox.bottom).toBeLessThanOrEqual(detailBox.bottom);
    expect(arrowBoxes.every((box) => box.left >= diorama!.left && box.right <= diorama!.right)).toBe(true);
    expect(
      arrowBoxes.every((box) => Math.abs(box.top + box.height / 2 - (diorama!.top + diorama!.height / 2)) <= 1),
    ).toBe(true);
  });
});

test('Pixel Art Atlas is badged and the per-game setting filters and restores it', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await installAuthRoutes(page, { signedIn: true, github: 'kim' });
  await installNewRoutes(page);
  await page.route('**/api/catalog/style-families', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiStyleCatalog) }),
  );
  await page.route('**/api/v1/me/commands', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"commands":[]}' }),
  );

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1180, height: 820 },
  ]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/new?test&step=family', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__ogmHost?.get('new') !== undefined);
      await page.getByRole('button', { name: 'Pixel art' }).dispatchEvent('click');

      const atlas = page.getByRole('button', { name: 'Pixel Art Atlas, AI-generated' });
      await expect(atlas).toBeVisible();
      await expect(atlas.getByLabel('AI-generated')).toHaveText('AI');
      await expect(page.getByRole('button', { name: 'Pixel Town' }).getByLabel('AI-generated')).toHaveCount(0);
      await attachCdpScreenshot(page, testInfo, `pixel-art-atlas-${viewport.width}x${viewport.height}`);

      const setting = page.getByRole('switch', { name: 'AI-generated assets' });
      await expect(setting).toBeChecked();
      await setting.dispatchEvent('click');
      await expect(atlas).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Pixel Town' })).toBeVisible();

      await setting.dispatchEvent('click');
      await expect(
        page.getByRole('button', { name: 'Pixel Art Atlas, AI-generated' }).getByLabel('AI-generated'),
      ).toHaveText('AI');
    });
  }
});

const aiStyleCatalog = [
  {
    id: 'pixel-art',
    label: 'Pixel art',
    views: ['topdown', 'side'],
    creationChoice: true,
    packs: [],
    sets: [
      {
        id: 'pixel-town',
        label: 'Pixel Town',
        pickerFamilies: [],
        vendors: ['fixture'],
        traits: { pixel_size: '16 px', judgment: 'fixture' },
        packs: [
          {
            id: 'pixel-town',
            name: 'Pixel Town',
            thumbnailUrl: '/e2e/pixel.svg',
            aiGenerated: false,
          },
        ],
      },
      {
        id: 'angais-pixel-art-atlas',
        label: 'Pixel Art Atlas',
        pickerFamilies: [],
        vendors: ['angais'],
        traits: { pixel_size: '16 px', judgment: 'fixture' },
        packs: [
          {
            id: 'angais-pixel-art-atlas',
            name: 'Pixel Art Atlas',
            thumbnailUrl: '/e2e/pixel.svg',
            aiGenerated: true,
          },
        ],
      },
      {
        id: 'smallscaleint',
        label: 'SmallScaleInt',
        pickerFamilies: [],
        vendors: ['smallscaleint'],
        traits: { perspective: 'isometric 2:1', judgment: 'fixture' },
        packs: [
          {
            id: 'smallscaleint-knight',
            name: 'Knight',
            thumbnailUrl: '/e2e/knight.svg',
            aiGenerated: false,
          },
        ],
      },
    ],
  },
];

async function openReadyNewGame(page: Page): Promise<Locator> {
  await page.goto('/new?test&step=genre', { waitUntil: 'domcontentloaded' });
  const adventure = page.getByRole('button', { name: 'Adventure' });
  await Promise.all([page.waitForFunction(() => window.__ogmHost?.get('new') !== undefined), adventure.waitFor()]);
  return adventure;
}

async function selectOption(page: Page, button: Locator, key: string, id: string): Promise<void> {
  await expect(button).toBeVisible();
  await button.evaluate((element: HTMLButtonElement) => element.click());
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => newGameState(page).then((state) => state?.picks[key]?.picks)).toContain(id);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: 'disabled', fullPage: true }),
    contentType: 'image/png',
  });
}

async function attachCdpScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const path = testInfo.outputPath(`${name}.png`);
    await writeFile(path, Buffer.from(data, 'base64'));
    await testInfo.attach(name, { path, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
}

function newGameState(page: Page): Promise<NewGameTestApi | undefined> {
  return page.evaluate(() => window.__ogmHost?.get('new') as NewGameTestApi | undefined);
}

async function activate(page: Page, name: string | RegExp) {
  const button = page.getByRole('button', { name });
  await expect(button).toBeVisible();
  await button.evaluate((element: HTMLButtonElement) => element.click());
}
