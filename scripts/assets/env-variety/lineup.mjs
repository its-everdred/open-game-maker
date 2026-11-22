// Render set-piece lineups inside Dusk Helm's fields map through the real SmallScaleInt adapter (Phaser, headless
// Chromium on the GPU), one shot per plan entry, at phone and desktop sizes.
//
//   node scripts/assets/env-variety/lineup.mjs <plan.json> <pack Environment dir> <variants dir> <dry-grass dir> <out dir>
//
// <plan.json> maps a shot name to a list of extras: { "asset": "pack:Stone A1" | "variant:rock-mossy-a1",
// "facing": "N|E|S|W", "x": 2, "y": 3, "layer": "decor" }, plus optional "camera" { x, y, width, height } in world
// pixels. <dry-grass dir> holds N/E/S/W.png standing in for Dusk Helm's dry-grass-masked roof tile. Files are served
// to the page by request interception; nothing is copied or written outside <out dir>.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const adapter = resolve(here, '../../../packages/pack-adapters/smallscaleint');
const require = createRequire(join(adapter, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('@playwright/test');

const [planPath, envDir, variantsDir, dryGrassDir, outDir] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: lineup.mjs <plan.json> <env dir> <variants dir> <dry-grass dir> <out dir>');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const ORIGIN = 'http://lineup.local';
const roots = { pack: resolve(envDir), variant: resolve(variantsDir), dry: resolve(dryGrassDir) };
const fileUrl = (root, rel = '') => `${ORIGIN}/f/${root}/${rel}`;
const facings = (name) => Object.fromEntries(['N', 'E', 'S', 'W'].map((f) => [f, name(f)]));
const sprite = (url, files) => ({ url, meta: { sprite: { drawn_view: 'iso', facings: files } } });

function assetFor(id) {
  const [kind, name] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (kind === 'pack') return sprite(fileUrl('pack'), facings((f) => encodeURIComponent(`${name}_${f}.png`)));
  if (kind === 'variant') return sprite(fileUrl('variant', `${encodeURIComponent(name)}/`), facings((f) => `${f}.png`));
  throw new Error(`unknown asset ${id}`);
}

// Dusk Helm src/features/fields/map.ts (open-games), verbatim layout: a 9x9 field with a winding dirt route.
function fieldsMap() {
  const width = 9, height = 9;
  const floor = Array(width * height).fill(1);
  const grass = Array.from({ length: width * height }, (_, index) => {
    const x = index % width, y = Math.floor(index / width);
    const route = 4 + Math.round(Math.sin(y * 0.8));
    return Math.abs(x - route) <= 1 ? 0 : 2;
  });
  const dryGrass = grass.map((tile, index) => {
    const x = index % width, y = Math.floor(index / width);
    const hash = ((x * 37 + y * 67 + x * y * 19) ^ (x * 11 + y * 23)) >>> 0;
    return tile && hash % 7 < 2 ? 3 : 0;
  });
  const tile = (asset, id) => ({ id, properties: [
    { name: 'asset', value: asset }, { name: 'rotation', value: 0 }, { name: 'solid', value: false },
  ] });
  return {
    orientation: 'isometric', width, height, tilewidth: 128, tileheight: 64, infinite: false,
    tilesets: [{ firstgid: 1, name: 'fields', tiles: [tile('pack:Ground A1', 0), tile('pack:Ground A2', 1), tile('dry', 2)] }],
    layers: [
      { type: 'tilelayer', name: 'floor', width, height, data: Array(width * height).fill(0) },
      { type: 'tilelayer', name: 'wall', width, height, data: floor },
      { type: 'tilelayer', name: 'decor', width, height, data: grass },
      { type: 'tilelayer', name: 'roof', width, height, data: dryGrass },
      { type: 'objectgroup', name: 'spawns', objects: [] },
    ],
  };
}

const bundle = (
  await build({
    entryPoints: [join(here, 'scene.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    nodePaths: [join(adapter, 'node_modules')],
    logLevel: 'error',
  })
).outputFiles[0].text;

const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sizes = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }, desktop: { width: 1440, height: 900 } };
// Dusk Helm's Fields camera: zoom = min(w / 450, h / 375), centred on (576, 288).
const defaultCamera = { x: 576, y: 288, width: 450, height: 375 };
try {
  for (const [shot, entry] of Object.entries(plan)) {
    const extras = entry.extras ?? entry;
    const assets = { 'pack:Ground A1': assetFor('pack:Ground A1'), 'pack:Ground A2': assetFor('pack:Ground A2') };
    assets.dry = sprite(fileUrl('dry'), facings((f) => `${f}.png`));
    for (const extra of extras) assets[extra.asset] ??= assetFor(extra.asset);
    const spec = { map: fieldsMap(), assets, extras, jitterRoof: true, camera: entry.camera ?? defaultCamera };
    for (const [size, viewport] of Object.entries(sizes)) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, ...viewport });
      page.on('pageerror', (error) => console.error(shot, size, error.message));
      await page.route(`${ORIGIN}/**`, async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname);
        if (path === '/') {
          return route.fulfill({
            contentType: 'text/html',
            body: `<body style="margin:0;overflow:hidden"><script>window.spec=${JSON.stringify(spec)};</script><script>${bundle}</script></body>`,
          });
        }
        const [, prefix, root, ...rest] = path.split('/');
        if (prefix !== 'f' || !(root in roots)) return route.fulfill({ status: 404 });
        const file = resolve(roots[root], rest.join('/'));
        if (!file.startsWith(roots[root])) return route.fulfill({ status: 403 });
        try {
          return route.fulfill({ body: readFileSync(file), contentType: extname(file) === '.png' ? 'image/png' : 'application/octet-stream' });
        } catch {
          return route.fulfill({ status: 404 });
        }
      });
      await page.goto(`${ORIGIN}/`);
      await page.waitForFunction(() => window.ready === true, null, { timeout: 120_000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `${shot}.${size}.png`) });
      await page.close();
      console.log(`${shot}.${size}.png`);
    }
  }
} finally {
  await browser.close();
}
