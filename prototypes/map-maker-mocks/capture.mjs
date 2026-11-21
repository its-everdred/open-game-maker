// Render every mock at phone portrait and desktop: node capture.mjs <out-dir>
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.argv[2] ?? 'out');
const shots = [
  ...['A', 'B', 'C'].flatMap((m) => [
    [`mock${m}.html?v=phone`, `${m}-phone.png`, 390, 844, 2],
    [`mock${m}.html?v=desk`, `${m}-desk.png`, 1280, 800, 1],
  ]),
  ...['snap', 'free', 'drag', 'tap', 'lock', 'agent'].map((q) => [`mockD.html?q=${q}`, `D-${q}.png`, 640, 480, 1]),
];
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
for (const [page, file, width, height, scale] of shots) {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await tab.goto(`file://${here}${page}`);
  await tab.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await tab.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => {}))));
  await tab.waitForTimeout(400);
  await tab.screenshot({ path: resolve(out, file) });
  await tab.close();
}
await browser.close();
