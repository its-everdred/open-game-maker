#!/usr/bin/env node
/**
 * Record scripted real-gameplay takes from a browser game, one frame per step, whatever the host load.
 *
 *   node .claude/skills/gm-trailer/scripts/capture.mjs --url http://127.0.0.1:<port>/ --shots trailer-shots.mjs \
 *     --out <takes dir> [--viewport 1280x1100] [--canvas canvas] [--grab jpeg|png] [--gpu]
 *
 * The page loads once. requestAnimationFrame is replaced so the game only advances when a step runs two 60 Hz
 * frames (one 30 fps capture frame), and the canvas is read in the same task that drew it, so a WebGL canvas without
 * preserveDrawingBuffer still reads back. window.__vt is the virtual time in ms; a game's sound hooks can stamp cues
 * with it (see `init` below) so effects land on their frame in the mix.
 *
 * The shots module exports `init` (optional, a function run in the page before any script, e.g. to log sounds into
 * window.__cues as { name, t: window.__vt }) and `default`, an async function (cap) => void that records takes:
 *
 *   const take = await cap.take('boss-hit');      // starts a folder <out>/boss-hit with f00000.jpg…
 *   await cap.eval(() => go('battle', 'bugon'));  // the game's own entry point (scenario, save, scene jump)
 *   await cap.hold('ArrowRight', 40, take);       // hold a key for 40 frames, recording
 *   await cap.tap(' ', take);                     // press and release
 *   await cap.run(90, take);                      // just let it play
 *   await take.end();                             // writes take.json with frames, fps and window.__cues heard
 *
 * Pass `null` instead of a take to advance without recording (menus, walk-ups). Needs Playwright (the gm-verify
 * dependency); run with `nice` on a shared host and stop any local server you started when done.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const FPS = 30;
const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    shots: { type: 'string' },
    out: { type: 'string' },
    viewport: { type: 'string', default: '1280x1100' },
    canvas: { type: 'string', default: 'canvas' },
    grab: { type: 'string', default: 'jpeg' },
    gpu: { type: 'boolean', default: false },
  },
});
if (!args.url || !args.shots || !args.out) {
  console.error('usage: capture.mjs --url <game url> --shots <module> --out <takes dir>');
  process.exit(2);
}
let chromium;
try {
  ({ chromium } = createRequire(join(process.cwd(), 'noop.js'))('playwright'));
} catch {
  console.error('playwright is not installed here; run from a workspace that has it (gm-verify depends on it)');
  process.exit(2);
}

const shots = await import(pathToFileURL(resolve(args.shots)).href);
const [width, height] = args.viewport.split('x').map(Number);
const mime = args.grab === 'png' ? 'image/png' : 'image/jpeg';
const browser = await chromium.launch({
  args: args.gpu ? ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
page.setDefaultTimeout(600000);
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.addInitScript(() => {
  window.__vt = 0;
  window.__cues = [];
  const queue = [];
  window.requestAnimationFrame = (cb) => queue.push(cb);
  window.cancelAnimationFrame = () => {};
  window.__frame = (ms) => {
    window.__vt += ms;
    for (const cb of queue.splice(0)) cb(window.__vt);
  };
});
if (shots.init) await page.addInitScript(shots.init);
await page.goto(args.url, { waitUntil: 'load', timeout: 900000 });

async function step(take) {
  const data = await page.evaluate(
    ([selector, grab]) => {
      window.__frame(1000 / 60);
      window.__frame(1000 / 60);
      return grab ? document.querySelector(selector).toDataURL(grab, 0.95) : null;
    },
    [args.canvas, take ? mime : null],
  );
  if (take) take.save(data);
}

const cap = {
  page,
  eval: (fn, arg) => page.evaluate(fn, arg),
  step,
  async run(frames, take) {
    for (let i = 0; i < frames; i++) await step(take);
  },
  async hold(key, frames, take) {
    for (const k of [].concat(key)) await page.keyboard.down(k);
    await cap.run(frames, take);
    for (const k of [].concat(key)) await page.keyboard.up(k);
  },
  async tap(key, take, after = 3) {
    await page.keyboard.down(key);
    await step(take);
    await page.keyboard.up(key);
    await cap.run(after, take);
  },
  async take(id) {
    const dir = join(args.out, id);
    mkdirSync(dir, { recursive: true });
    const t0 = await page.evaluate(() => window.__vt);
    const n0 = await page.evaluate(() => window.__cues.length);
    let frame = 0;
    return {
      dir,
      save(dataUrl) {
        const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
        const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        writeFileSync(join(dir, `f${String(frame).padStart(5, '0')}.${ext}`), bytes);
        frame += 1;
      },
      async end(meta = {}) {
        const cues = (await page.evaluate((n) => window.__cues.slice(n), n0)).map((c) => ({ ...c, t: +((c.t - t0) / 1000).toFixed(3) }));
        writeFileSync(join(dir, 'take.json'), JSON.stringify({ id, frames: frame, fps: FPS, ...meta, cues }, null, 1));
        console.error(`take ${id}: ${frame} frames`);
      },
    };
  },
};

try {
  await shots.default(cap);
} finally {
  await browser.close();
}
