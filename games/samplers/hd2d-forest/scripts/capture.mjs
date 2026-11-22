// Stills, a toggle clip and an fps sample of a running build. Output goes under assets-local (licensed pixels).
// usage: node scripts/capture.mjs --url http://127.0.0.1:4173/ --out ../../../assets-local/review/1149
import { mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:4173/' },
    out: { type: 'string', default: '../../../assets-local/review/1149' },
    gl: { type: 'string', default: 'gl-egl' },
  },
});
const out = resolve(values.out);
await mkdir(out, { recursive: true });

const VIEWPORTS = { desktop: { width: 1280, height: 720 }, phone: { width: 390, height: 844 } };
const PRESETS = ['golden', 'daylight', 'amber'];
const browser = await chromium.launch({
  args: [`--use-angle=${values.gl}`, '--enable-gpu', '--ignore-gpu-blocklist'],
});

async function open(viewport, query, video) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: out, size: viewport } } : {}),
  });
  const page = await context.newPage();
  const created = Date.now();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(`${values.url}?${query}`);
  await page.waitForFunction(() => window.__forest?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  return { context, page, errors, created };
}

const report = { stills: [], fps: {}, errors: [] };
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  for (const preset of PRESETS) {
    const { context, page, errors } = await open(viewport, `preset=${preset}`);
    const file = join(out, `${preset}-${name}.png`);
    await page.screenshot({ path: file });
    // With lighting and focus both on, the far bands must still blur (the lighting overlay once flattened them).
    const blur = await page.evaluate(() => window.__forest.bandBlur());
    if (!blur.some((value) => value > 0)) throw new Error(`${preset} ${name}: no depth band is blurred`);
    report.bandBlur = { ...report.bandBlur, [`${preset}-${name}`]: blur };
    report.stills.push(file);
    report.errors.push(...errors);
    await context.close();
  }
  for (const [label, query] of [
    ['off', 'lighting=0&focus=0'],
    ['lighting', 'focus=0'],
    ['focus', 'lighting=0'],
    ['low', 'quality=low'],
  ]) {
    const { context, page, errors } = await open(viewport, query);
    const file = join(out, `amber-${label}-${name}.png`);
    await page.screenshot({ path: file });
    if (label === 'low') {
      // Kevin keeps the blur on the low tier and saves by lighting fewer sprites instead.
      const blur = await page.evaluate(() => window.__forest.bandBlur());
      if (!blur.some((value) => value > 0)) throw new Error(`low ${name}: no depth band is blurred`);
      report.bandBlur = { ...report.bandBlur, [`low-${name}`]: blur };
      report.litSprites = { ...report.litSprites, [name]: await page.evaluate(() => window.__forest.litSprites()) };
    }
    report.stills.push(file);
    report.errors.push(...errors);
    await context.close();
  }
  // Frame rate after warm-up for each quality tier and with everything off.
  for (const [label, query] of [
    ['high', 'quality=high'],
    ['low', 'quality=low'],
    ['off', 'lighting=0&focus=0'],
  ]) {
    const { context, page } = await open(viewport, query);
    const fps = await page.evaluate(
      () =>
        new Promise((done) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames += 1;
            if (performance.now() - start < 4000) requestAnimationFrame(tick);
            else done((frames * 1000) / (performance.now() - start));
          };
          requestAnimationFrame(tick);
        }),
    );
    report.fps[`${name}-${label}`] = Math.round(fps * 10) / 10;
    await context.close();
  }
}

// The toggle clip, phone portrait: all off, lighting, focus on the default (Amber), then the other two presets.
{
  const { context, page, errors, created } = await open(VIEWPORTS.phone, 'lighting=0&focus=0', true);
  const steps = [
    [2000, () => {}],
    [2500, () => window.__forest.setLighting(true)],
    [2500, () => window.__forest.setFocus(true)],
    [2500, () => window.__forest.setPreset('daylight')],
    [2500, () => window.__forest.setPreset('golden')],
  ];
  const marks = [];
  for (const [wait, step] of steps) {
    await page.evaluate(step);
    marks.push((Date.now() - created) / 1000);
    await page.waitForTimeout(wait);
  }
  report.errors.push(...errors);
  const video = page.video();
  await context.close();
  await rename(await video.path(), join(out, 'toggles-phone.webm'));
  report.clipMarks = marks;
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
