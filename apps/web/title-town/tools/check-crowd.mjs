#!/usr/bin/env node
// Serve title-town, then run this against the same scene and portrait camera as the title.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../') + '/');
const { chromium } = require('playwright');
const port = process.env.PORT || 8792;
const args = process.env.GM_VERIFY_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  page.on('pageerror', error => console.error('pageerror:', error));
  await page.goto(`http://127.0.0.1:${port}/index.html?capture&cam=menu&scene=all`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__ready && window.__crowdStep, null, { timeout: 300000 });
  const result = await page.evaluate(() => {
    const failures = [], previous = new Map(), initial = new Map(), duration = window.__sounds?.per ?? 153;
    for (let t = 0; t <= duration + .25; t += .25) {
      const crowd = window.__crowdStep(t);
      if (crowd?.length !== 25) { failures.push({ t, problem: `expected 25 people, found ${crowd?.length ?? 0}` }); break; }
      for (const person of crowd) {
        if (!person.valid) failures.push({ t, i: person.i, problem: 'invalid position' });
        if (t === 0) initial.set(person.i, person.position);
        if (t === duration && initial.has(person.i) && Math.hypot(...person.position.map((v, j) => v - initial.get(person.i)[j])) > .01) failures.push({ t, i: person.i, problem: 'jumps at loop boundary' });
        if (person.blocked || person.prop) failures.push({ t, i: person.i, problem: person.prop ? 'overlaps a prop' : 'overlaps a footprint' });
        if (previous.get(person.i) === false && person.visible && person.inView) failures.push({ t, i: person.i, problem: 'appears in view' });
        previous.set(person.i, person.visible);
      }
    }
    return { duration, failures, marks: window.__marks };
  });
  if (result.failures.length) throw new Error(JSON.stringify({ duration: result.duration, count: result.failures.length, first: result.failures.slice(0, 20) }));
  console.log(`Crowd check passed for ${result.duration} seconds and the loop boundary`, JSON.stringify(result.marks));
} finally {
  await browser.close();
}
