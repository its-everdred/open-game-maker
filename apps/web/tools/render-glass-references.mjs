// Render native artboards from the approved HTML. No resized landscape substitutes.
// Usage: node apps/web/tools/render-glass-references.mjs <output-directory> <artboard> [...]
/* global document */
import { createHash } from 'node:crypto';
import console from 'node:console';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const prototype = resolve(root, 'prototypes/ogm-glass');
const [out, ...names] = process.argv.slice(2);
if (!out || names.length === 0) throw new Error('Provide an output directory and at least one artboard name');
const canvas = JSON.parse(await readFile(resolve(prototype, 'canvas.json'), 'utf8'));
const references = JSON.parse(await readFile(resolve(root, 'tests/design-baselines/ogm-glass/manifest.json'), 'utf8'));
const targets = names.map((name) => {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid artboard name: ${name}`);
  const board = canvas.boards[`${name}.dc.html`];
  const reference = references.find((entry) => entry.artboard === name);
  if (!board || !reference) throw new Error(`No approved native artboard and reference metadata for ${name}`);
  const scale = reference.width / board.w;
  if (!Number.isInteger(scale) || scale < 1 || board.h * scale !== reference.height)
    throw new Error(`Reference size does not match the native canvas for ${name}`);
  return { name, width: board.w, height: board.h, scale };
});

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const prefix = path.startsWith('/prototypes/ogm-glass/')
      ? '/prototypes/ogm-glass/'
      : path.startsWith('/assets-local/review/design-ogm-glass/img/')
        ? '/assets-local/review/design-ogm-glass/img/'
        : undefined;
    if (!prefix) throw new Error('Not a reference asset');
    const file = resolve(root, `.${path}`);
    const rel = relative(resolve(root, `.${prefix}`), file);
    if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Invalid path');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'content-type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', accept);
});
let browser;
try {
  browser = await chromium.launch({
    args:
      process.env.GM_VERIFY_SOFTWARE_GL === '1'
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const output = resolve(out);
  await mkdir(output, { recursive: true });
  const rendered = [];
  const stylesheet = await readFile(resolve(prototype, 'glass.css'));
  const stylesheetSha256 = createHash('sha256').update(stylesheet).digest('hex');
  for (const target of targets) {
    console.log(`Rendering ${target.name} at ${target.width}x${target.height} (${target.scale}x)`);
    const page = await browser.newPage({
      viewport: { width: target.width, height: target.height },
      deviceScaleFactor: target.scale,
      reducedMotion: 'reduce',
    });
    try {
      const failed = [];
      page.on('requestfailed', (request) => failed.push(new URL(request.url()).pathname));
      page.on('response', (response) => {
        if (response.status() >= 400) failed.push(new URL(response.url()).pathname);
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/prototypes/ogm-glass/${target.name}.html`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      const ready = await page.evaluate(async () => {
        await Promise.all([document.fonts.load('600 16px Fredoka'), document.fonts.load('600 16px Nunito')]);
        await document.fonts.ready;
        return {
          fonts: document.fonts.check('600 16px Fredoka') && document.fonts.check('600 16px Nunito'),
          missingImages: [...document.images]
            .filter((image) => !image.complete || image.naturalWidth === 0 || image.dataset.fallback)
            .map((image) => image.dataset.fallback || image.getAttribute('src')),
        };
      });
      if (failed.length || !ready.fonts || ready.missingImages.length)
        throw new Error(`Incomplete assets for ${target.name}: ${JSON.stringify({ failed, ...ready })}`);
      const png = await page.screenshot({ timeout: 120_000 });
      const source = await readFile(resolve(prototype, `${target.name}.html`));
      const file = `${target.name}-${target.width * target.scale}x${target.height * target.scale}.png`;
      await writeFile(resolve(output, file), png);
      rendered.push({
        artboard: target.name,
        file,
        width: target.width * target.scale,
        height: target.height * target.scale,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        stylesheetSha256,
        pngSha256: createHash('sha256').update(png).digest('hex'),
      });
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, 'rendered.json'), `${JSON.stringify(rendered, null, 2)}\n`);
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
}
