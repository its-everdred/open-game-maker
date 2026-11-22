// Stills of the card strip variations at four sizes, plus a phone clip of each being used:
// node strip-capture.mjs <out-dir>   (webm clips; convert with ffmpeg)
import { createRequire } from 'node:module';
import { mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.argv[2] ?? 'out');
mkdirSync(out, { recursive: true });
const sizes = [[390, 844], [844, 390], [820, 1180], [1180, 820]];
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const broken = [];
const open = async (context, v) => {
  const tab = await context.newPage();
  tab.on('requestfailed', (r) => r.url().startsWith('file:') && broken.push(`${v}: ${decodeURI(r.url())}`));
  tab.on('pageerror', (e) => broken.push(`${v}: ${e.message}`));
  await tab.goto(`file://${here}strip.html?v=${v}`);
  await tab.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await tab.waitForTimeout(500);
  return tab;
};
for (const v of ['A', 'B', 'C']) {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const tab = await open(context, v);
    await tab.screenshot({ path: resolve(out, `${v}-${width}x${height}.png`) });
    await context.close();
  }
  // Clip: switch scenes, add a scene, hide and show the strip.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, recordVideo: { dir: out, size: { width: 390, height: 844 } } });
  const tab = await open(context, v);
  const card = (i) => tab.locator(`.scard[data-i="${i}"]`);
  const pause = (ms = 900) => tab.waitForTimeout(ms);
  await pause();
  if (v === 'C') {
    for (const i of [1, 2]) { await tab.evaluate((x) => document.getElementById('strip').scrollTo({ left: x, behavior: 'smooth' }), i * (await card(0).boundingBox()).width + i * 10); await pause(1400); }
  } else {
    await card(1).click(); await pause(1200);
    await card(2).click(); await pause(1200);
    await card(3).click(); await pause(1200);
  }
  await tab.locator('#add').click(); await pause(1200);
  await card(0).click(); await pause(1200);
  await tab.locator('#tog').click(); await pause(1200);
  await tab.locator('#tog').click(); await pause(1000);
  const video = await tab.video().path();
  await context.close();
  renameSync(video, resolve(out, `${v}-clip.webm`));
}
await browser.close();
if (broken.length) { console.error([...new Set(broken)].join('\n')); process.exit(1); }
