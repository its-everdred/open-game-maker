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
    const failures = [], previous = new Map(), positions = new Map(), duration = window.__sounds?.per ?? 153;
    for (let t = 0; t <= duration + .25; t += .25) {
      const crowd = window.__crowdStep(t);
      if (crowd?.length !== 25) { failures.push({ t, problem: `expected 25 people, found ${crowd?.length ?? 0}` }); break; }
      if (crowd.filter(person => person.stationaryFallback).length > 2) failures.push({ t, problem: 'too many stationary fallback defenders', people: crowd.filter(person => person.stationaryFallback).map(person => ({ i: person.i, reason: person.fallbackReason })) });
      if (crowd.filter(person => person.wanderer).length > 3) failures.push({ t, problem: 'too many defenders diverted from the fight' });
      const crew = crowd.filter(person => person.field);
      if (crew.length !== 4 || crew.some(person => !person.fieldRouteComplete)) failures.push({ t, problem: 'field crew route incomplete' });
      if ((t < 30 || (t >= 62 && t < 88)) && crew.some(person => !person.pushing || person.fieldDistance > person.fieldCrewLimit)) failures.push({ t, problem: 'field crew not pushing' });
      for (const person of crowd) {
        if (person.returnSafe === false) failures.push({ t, i: person.i, problem: 'no safe return route' });
        const prior = positions.get(person.i);
        if (prior && Math.hypot(...person.position.map((v, j) => v - prior[j])) > 5) failures.push({ t, i: person.i, problem: 'jump between samples' });
        positions.set(person.i, person.position);
        if (person.spearman && ((t >= 32.25 && t < 38.5) || (t >= 46.25 && t < 57.75)) && person.gait) failures.push({ t, i: person.i, problem: 'moving during stationary hold' });
        if (!person.valid) failures.push({ t, i: person.i, problem: 'invalid position' });
        if (!person.visible) failures.push({ t, i: person.i, problem: 'unexpectedly hidden' });
        if (person.blocked || person.prop.length) failures.push({ t, i: person.i, problem: person.prop.length ? 'overlaps a prop' : 'overlaps a footprint', position: person.position, prop: person.prop[0] });
        if (previous.get(person.i) === false && person.visible && person.inView) failures.push({ t, i: person.i, problem: 'appears in view' });
        previous.set(person.i, person.visible);
      }
      for (let i = 0; i < crowd.length; i++) for (let j = i + 1; j < crowd.length; j++) {
        const a = crowd[i], b = crowd[j];
        if (Math.abs(a.height - b.height) < 2 && Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) < .9)
          failures.push({ t, i: a.i, other: b.i, problem: 'people overlap' });
      }
      if (failures.length >= 20) break;
    }
    const end = window.__crowdStep(duration - .001), beginning = window.__crowdStep(duration);
    for (let i = 0; i < end.length; i++)
      if (Math.hypot(...end[i].position.map((v, j) => v - beginning[i].position[j])) > .05)
        failures.push({ t: duration, i, problem: 'jumps at loop boundary' });
    if (!beginning.some(person => person.visible && person.inView)) failures.push({ t: 0, problem: 'no visible person in view' });
    return { duration, failures, marks: window.__marks };
  });
  if (result.failures.length) throw new Error(JSON.stringify({ duration: result.duration, count: result.failures.length, first: result.failures.slice(0, 20) }));
  console.log(`Crowd check passed for ${result.duration} seconds and the loop boundary`, JSON.stringify(result.marks));
} finally {
  await browser.close();
}
