// Stills of the card strip variations at four sizes, plus a phone clip of each being used:
// node strip-capture.mjs <out-dir> [game-url]   (webm clips; convert with ffmpeg)
// With a served Dusk Helm build, the cards open its real scenes and their pictures are taken from it first (into real/).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.argv[2] ?? 'out');
const game = process.argv[3];
const settle = game ? 25000 : 500; /* the game needs time to load its assets */
mkdirSync(out, { recursive: true });
const sizes = [[390, 844], [844, 390], [820, 1180], [1180, 820]];
/* The framed game only starts for an http host page, so serve this folder. */
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' };
const server = createServer((req, res) => {
  try { const path = resolve(here, decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1))); res.writeHead(200, { 'content-type': types[path.split('.').pop()] ?? 'application/octet-stream' }); res.end(readFileSync(path)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
if (game) {
  mkdirSync(resolve(here, 'real'), { recursive: true });
  for (const scenario of ['graveyard-landmark', 'lush-fields', 'goblin-cave', 'miniboss-arena']) {
    const tab = await browser.newPage({ viewport: { width: 600, height: 400 } });
    await tab.goto(`${game}?scenario=${scenario}`);
    await tab.waitForTimeout(settle);
    await tab.screenshot({ path: resolve(here, 'real', `${scenario}.png`), clip: { x: 0, y: 64, width: 600, height: 336 }, timeout: 180000 }); /* below the game's top band */
    await tab.close();
  }
}
const broken = [];
const open = async (context, v) => {
  const tab = await context.newPage();
  tab.on('requestfailed', (r) => r.url().startsWith(base) && broken.push(`${v}: ${decodeURI(r.url())}`));
  tab.on('response', (r) => r.url().startsWith(base) && r.status() === 404 && broken.push(`${v}: ${decodeURI(r.url())}`));
  tab.on('pageerror', (e) => broken.push(`${v}: ${e.message}`));
  await tab.goto(`${base}strip.html?v=${v}${game ? `&game=${encodeURIComponent(game)}` : ''}`);
  await tab.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await tab.waitForTimeout(settle);
  return tab;
};
for (const v of ['A', 'B', 'C']) {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: game ? 1 : 2 });
    const tab = await open(context, v);
    await tab.screenshot({ path: resolve(out, `${v}-${width}x${height}.png`), timeout: 180000 });
    await context.close();
  }
  // Clip: switch scenes, add a scene, hide and show the strip.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: game ? 1 : 2, hasTouch: true, recordVideo: { dir: out, size: { width: 390, height: 844 } } });
  const tab = await open(context, v);
  const card = (i) => tab.locator(`.scard[data-i="${i}"]`);
  const pause = (ms = 900) => tab.waitForTimeout(game && ms > 1000 ? ms * 4 : ms); /* a newly opened game takes seconds to load */
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
server.close();
if (broken.length) { console.error([...new Set(broken)].join('\n')); process.exit(1); }
