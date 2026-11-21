import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname);
const require = createRequire(resolve(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('playwright');
const port = 4179;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(root + sep) && path !== root) throw new Error('outside capture root');
    const data = await readFile(path);
    res.setHeader('Content-Type', extname(path) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
});
server.listen(port, '127.0.0.1');
await new Promise((resolveListen) => server.once('listening', resolveListen));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-crash-reporter', '--disable-breakpad', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', (error) => console.error(error.message));
  await page.goto(`http://127.0.0.1:${port}/layered.html`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/captures/layered.png` });
  await page.getByRole('button', { name: 'Tilt-shift' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${root}/captures/layered-tilt.png` });
  await page.getByRole('button', { name: 'Pixel protect' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${root}/captures/layered-pixel-protect.png` });
  await page.goto(`http://127.0.0.1:${port}/three.html`);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${root}/captures/three-no-blur.png` });
  await page.getByRole('button', { name: 'BokehPass' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${root}/captures/three-bokeh.png` });
  await page.getByRole('button', { name: 'Depth haze' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${root}/captures/three-haze.png` });
  await page.close();
  const frames = ['tilt', 'pixel-protect'].map((mode) => `${root}/captures/layered-${mode}.png`);
  const clip = spawn('ffmpeg', ['-y', ...frames.flatMap((file) => ['-loop', '1', '-t', '2.5', '-i', file]), '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-t', '5', '-pix_fmt', 'yuv420p', `${root}/captures/layered.mp4`], { stdio: 'ignore' });
  await new Promise((resolveClip, rejectClip) => { clip.once('exit', (code) => code === 0 ? resolveClip() : rejectClip(new Error(`ffmpeg exited ${code}`))); });
} finally {
  await browser.close();
  server.close();
}
