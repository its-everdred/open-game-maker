import { expect, test, type Page } from '@playwright/test';
import { env } from 'node:process';

const ALL_ON = 'facade=1&lighting=1&focus=1&particles=1&seed=7';
/** Frames the probe times per tier. */
const PROBE_FRAMES = 10;

// Software GL (CI) takes seconds per all-on Phaser frame, and each test boots the clearing several times.
test.setTimeout(240_000);

/**
 * Boots the clearing through `createHd2d` and steps it to 2000 ms twice; returns both hashes and the fixture info.
 * `via: 'editor'` applies `scene` through the editor's link (bridge `hd2d.apply`) instead of `applyScene`.
 */
async function render(page: Page, query: string, scene?: string, via: 'game' | 'editor' = 'game') {
  await page.goto(`/hd2d/?${query}`);
  await expect.poll(() => page.evaluate(() => window.__hd2d?.ready)).toBe(true);
  return page.evaluate(
    async ({ applied, editor }) => {
      const fixture = window.__hd2d!;
      if (applied) {
        if (editor) fixture.applyLinked!(applied);
        else fixture.applyScene!(applied);
        await fixture.frame(0);
      }
      await fixture.frame(2000);
      const first = fixture.hash();
      await fixture.frame(2000);
      return { first, second: fixture.hash(), info: fixture.info() };
    },
    { applied: scene, editor: via === 'editor' },
  );
}

for (const renderer of ['phaser', 'three'] as const) {
  test(`${renderer} facade renders every module deterministically, and each tier differently`, async ({ page }) => {
    const hashes: string[] = [];
    for (const quality of ['off', 'low', 'high'] as const) {
      const result = await render(page, `${ALL_ON}&renderer=${renderer}&quality=${quality}`);
      expect(result.second).toBe(result.first);
      expect(result.info.mounted).toEqual(['lighting', 'focus', 'particles']);
      hashes.push(result.first);
    }
    expect(new Set(hashes).size).toBe(3);
  });

  test(`${renderer} facade draws the same frame booted with a scene or applied to a running one`, async ({ page }) => {
    const booted = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high`);
    const scene = booted.info.scene!;
    // The alternate boot is a different look, so a match proves applyScene replaced it.
    const alternate = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high&boot=alt`);
    expect(alternate.first).not.toBe(booted.first);
    const applied = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high&boot=alt`, scene);
    expect(applied.first).toBe(booted.first);
  });

  // Runtime parity (#1211): what Kevin sets in the map maker is what plays. An edit sent from the editor renders the
  // same pixels as the game booted with that document.
  test(`${renderer} editor edit draws the same frame as the game booted with it`, async ({ page }) => {
    const booted = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high`);
    const alternate = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high&boot=alt`);
    expect(alternate.first).not.toBe(booted.first);
    const edited = await render(
      page,
      `${ALL_ON}&renderer=${renderer}&quality=high&boot=alt`,
      booted.info.scene!,
      'editor',
    );
    expect(edited.first).toBe(booted.first);
  });

  test(`${renderer} facade lights the scene when focus has no hero to keep crisp`, async ({ page }) => {
    const { info } = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high`);
    const scene = JSON.parse(info.scene!) as { focus: Record<string, unknown>; lighting: Record<string, unknown> };
    delete scene.focus.hero;
    const dim = { ...scene, lighting: { ...scene.lighting, ambient: { color: '#203060', intensity: 0.1 } } };
    const lit = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high`, JSON.stringify(scene));
    expect(lit.second).toBe(lit.first);
    const dimmed = await render(page, `${ALL_ON}&renderer=${renderer}&quality=high`, JSON.stringify(dim));
    expect(dimmed.first).not.toBe(lit.first);
  });

  test(`${renderer} facade frame-time probe per tier (a record, not a gate)`, async ({ page }, testInfo) => {
    // SwiftShader times the CPU rasterizer, not the device: the record is only taken on real GPU Chromium.
    test.skip(env.GM_VERIFY_SOFTWARE_GL === '1', 'frame times under software GL are not a device record');
    for (const quality of ['off', 'low', 'high'] as const) {
      await page.goto(`/hd2d/?${ALL_ON}&renderer=${renderer}&quality=${quality}`);
      await expect.poll(() => page.evaluate(() => window.__hd2d?.ready)).toBe(true);
      const stats = await page.evaluate(async (frames) => {
        const fixture = window.__hd2d!;
        for (let index = 1; index <= frames; index += 1) await fixture.frame((index * 1000) / 60);
        return fixture.info().frameMs;
      }, PROBE_FRAMES);
      const tier = stats[quality]!;
      expect(tier.frames).toBe(PROBE_FRAMES);
      const line = `${renderer} ${quality}: mean ${tier.mean.toFixed(1)} ms, p95 ${tier.p95.toFixed(1)} ms`;
      testInfo.annotations.push({ type: 'frame-time', description: line });
      console.log(`[hd2d frame-time] ${line}`);
    }
  });
}
