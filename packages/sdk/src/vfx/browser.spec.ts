import { expect, test, type Page } from '@playwright/test';

/** The pixel finish's fire palette: every kept pixel must land on one of these, opaque. */
const FIRE = ['#3a1408', '#a8320c', '#f07818', '#ffc040', '#fff0c0'];
const FIRE_RGB = FIRE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(','));

// Software GL on a busy runner pays for every drawn frame.
test.setTimeout(120_000);

async function open(page: Page) {
  const runtime: string[] = [];
  page.on('request', (request) => {
    if (/effekseer/.test(request.url())) runtime.push(request.url());
  });
  await page.goto('/vfx/');
  await expect.poll(() => page.evaluate(() => window.__vfx?.ready)).toBe(true);
  return runtime;
}

/** Opaque-ish pixels of a capture, with their rows. */
function lit(capture: { width: number; data: number[] }, threshold = 8) {
  const out: { x: number; y: number; rgba: number[] }[] = [];
  for (let i = 0; i < capture.data.length; i += 4)
    if (capture.data[i + 3]! > threshold) {
      const p = i / 4;
      out.push({ x: p % capture.width, y: Math.floor(p / capture.width), rgba: capture.data.slice(i, i + 4) });
    }
  return out;
}

test('the runtime loads only when a scene starts effects, and the campfire burns and sparks rise', async ({ page }) => {
  const runtime = await open(page);
  // Pages and scenes without effects never fetch the runtime or its wasm.
  expect(runtime).toEqual([]);

  await page.evaluate(() => window.__vfx!.start({ effects: ['campfire'] }));
  expect(runtime.some((url) => url.endsWith('.wasm'))).toBe(true);
  expect(runtime.some((url) => url.endsWith('.js'))).toBe(true);

  // The effects canvas sits exactly over the game canvas.
  const [game, overlay] = await page.evaluate(() => window.__vfx!.rects());
  expect(overlay).toEqual(game);

  expect(await page.evaluate(() => window.__vfx!.play('campfire', 320, 300))).toBe(true);
  // Two seconds in 100 ms steps: software GL in CI pays for every drawn frame.
  await page.evaluate(() => window.__vfx!.step(20, 100));
  const capture = await page.evaluate(() => window.__vfx!.capture());
  const pixels = lit(capture);
  expect(pixels.length).toBeGreaterThan(200);
  // Fire is centred on its world position and rises from it (y down): nothing far below, plenty above.
  const scale = capture.width / 640;
  const xs = pixels.map((p) => p.x / scale);
  const median = xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  expect(Math.abs(median - 320)).toBeLessThan(24);
  expect(pixels.filter((p) => p.y / scale > 330).length).toBe(0);
  expect(pixels.filter((p) => p.y / scale < 280).length).toBeGreaterThan(50);

  expect(await page.evaluate(() => window.__vfx!.destroy())).toBe(0);
});

test('pixel games get coarse, hard, palette-clamped effects', async ({ page }) => {
  await open(page);
  await page.evaluate((palette) => window.__vfx!.start({ effects: ['campfire', 'cast'], pixelSize: 4, palette }), FIRE);
  await page.evaluate(() => {
    window.__vfx!.play('campfire', 320, 300);
    window.__vfx!.play('cast', 200, 180);
    window.__vfx!.step(5, 100);
  });
  const capture = await page.evaluate(() => window.__vfx!.capture());
  // One effect pixel per 4 CSS pixels, upscaled by the browser with hard pixels.
  expect([capture.width, capture.data.length / 4 / capture.width]).toEqual([160, 90]);
  const pixels = lit(capture, 0);
  expect(pixels.length).toBeGreaterThan(20);
  for (const { rgba } of pixels) {
    expect(rgba[3]).toBe(255);
    expect(FIRE_RGB).toContain(rgba.slice(0, 3).join(','));
  }
});

test('the budget caps effects per scene and steps quality down on slow frames', async ({ page }) => {
  await open(page);
  await page.evaluate(() =>
    window.__vfx!.start({ effects: ['torch'], maxEffects: 4, budget: { frameMs: 1000 / 30, slowFrames: 10 } }),
  );
  const played = await page.evaluate(() =>
    Array.from({ length: 6 }, (_, i) => window.__vfx!.play('torch', 100 + i * 60, 180)),
  );
  expect(played).toEqual([true, true, true, true, false, false]);

  // Ten 100 ms frames spend the budget: low halves the cap and stops the oldest effects past it.
  await page.evaluate(() => window.__vfx!.step(10, 100));
  expect(await page.evaluate(() => window.__vfx!.stats())).toMatchObject({ quality: 'low', effects: 2 });
  // Ten more turn effects off: nothing plays and the canvas is hidden.
  await page.evaluate(() => window.__vfx!.step(10, 100));
  expect(await page.evaluate(() => window.__vfx!.stats())).toMatchObject({ quality: 'off', effects: 0 });
  expect(await page.evaluate(() => window.__vfx!.play('torch', 100, 180))).toBe(false);
  expect(await page.evaluate(() => window.__vfx!.visibility())).toBe('hidden');
});

test('three effects cost little main-thread time on a phone-class CPU', async ({ page, browserName }) => {
  await open(page);
  await page.evaluate(() => window.__vfx!.start({ effects: ['campfire', 'cast', 'legendary'], pixelSize: 3 }));
  if (browserName === 'chromium') {
    // A 4x CPU slowdown stands in for a mid-range phone.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.evaluate(() => {
    window.__vfx!.play('campfire', 200, 300);
    window.__vfx!.play('legendary', 440, 300);
    window.__vfx!.step(10, 100);
    window.__vfx!.play('cast', 320, 160);
  });
  const cost = await page.evaluate(() => window.__vfx!.cost(40));
  test.info().annotations.push({ type: 'vfx cost (ms, 4x throttle)', description: JSON.stringify(cost) });
  console.log(`vfx cost ${browserName}: ${JSON.stringify(cost)}`);
  expect(cost.instances).toBeGreaterThan(50);
  // Simulation stays well inside a 30 fps frame even throttled. Draw time here is software GL, which says nothing
  // about a phone's GPU; it is logged, and the frame governor covers a slow GPU in the field.
  expect(cost.update.median).toBeLessThan(4);
});
