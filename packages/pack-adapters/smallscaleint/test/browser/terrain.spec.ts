import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';

import type { TerrainSpec } from '../../src/index.js';
import type { TerrainSceneConfig } from './terrain-scene.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const BACKGROUND = [0x10, 0x10, 0x14];
const TERRAINS: TerrainSpec[] = ['dirt', 'dry-grass', 'grass', 'dark-grass', 'cobble', 'paving'].map((id) => ({
  id,
  sheet: `t3:test/terrain-${id}`,
}));

let bundle: string | undefined;
async function open(page: Page, config: TerrainSceneConfig) {
  bundle ??= (
    await build({
      entryPoints: [`${here}/terrain-scene.ts`],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
    })
  ).outputFiles[0]!.text;
  await page.setContent(
    `<!doctype html><body style="margin:0;background:#101014">` +
      `<script>window.terrainConfig=${JSON.stringify(config)};${bundle}</script></body>`,
  );
  await page.waitForFunction(() => 'terrainReady' in window, undefined, { timeout: 60_000 });
}

/** Counts canvas pixels inside the map's cells (1 px in from every border) that still show the background. */
async function holes(page: Page, width: number, height: number) {
  return page.locator('canvas').evaluate(
    (source, [width, height, bg]) => {
      const canvas = source as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d')!;
      context.drawImage(canvas, 0, 0);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      const view = (window as unknown as { terrain: { view: { x: number; y: number } } }).terrain.view;
      let count = 0;
      let inside = 0;
      for (let py = 0; py < copy.height; py++) {
        for (let px = 0; px < copy.width; px++) {
          const wx = px + 0.5 + view.x - (height as number) * 64;
          const wy = py + 0.5 + view.y - 32;
          const u = wx / 128 + wy / 64;
          const v = wy / 64 - wx / 128;
          if (u < 0.05 || v < 0.05 || u > (width as number) - 0.05 || v > (height as number) - 0.05) continue;
          inside++;
          const i = (py * copy.width + px) * 4;
          const b = bg as number[];
          if (data[i] === b[0] && data[i + 1] === b[1] && data[i + 2] === b[2]) count++;
        }
      }
      return { count, inside };
    },
    [width, height, BACKGROUND] as const,
  );
}

async function pixelAt(page: Page, x: number, y: number) {
  return page.locator('canvas').evaluate(
    (source, [x, y]) => {
      const canvas = source as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d')!;
      context.drawImage(canvas, 0, 0);
      const view = (window as unknown as { terrain: { view: { x: number; y: number } } }).terrain.view;
      return Array.from(context.getImageData(Math.round(x! - view.x), Math.round(y! - view.y), 1, 1).data);
    },
    [x, y],
  );
}

const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

/** A 6x6 mix with all six terrains, three meeting at several corners. */
const MIXED = [
  0, 0, 2, 2, 3, 3, 0, 1, 2, 5, 3, 3, 1, 1, 5, 5, 4, 2, 1, 2, 5, 4, 4, 2, 0, 2, 2, 2, 4, 0, 0, 0, 3, 2, 0, 0,
];

for (const canvas of [false, true]) {
  const renderer = canvas ? 'Canvas' : 'WebGL';
  test(`${renderer}: transitions cover every map pixel and the brush repaints live, with undo`, async ({ page }) => {
    await open(page, {
      width: 6,
      height: 6,
      cells: MIXED,
      terrains: TERRAINS,
      seed: 3,
      urls: {},
      canvas,
      view: [900, 520],
    });
    const found = await holes(page, 6, 6);
    expect(found.inside).toBeGreaterThan(100_000);
    expect(found.count).toBe(0);

    // Cell (1,1) is dry grass; its centre sits at world (6*64 + 0, 64 + 2*32).
    const centre: [number, number] = [6 * 64, 64 + 64];
    const before = await pixelAt(page, ...centre);
    expect(before.slice(0, 3)).toEqual([0xc8, 0xb0, 0x40]);
    await page.evaluate(() =>
      (window as unknown as { terrain: { paint(x: number, y: number, t: number): void } }).terrain.paint(1, 1, 5),
    );
    await nextFrame(page);
    expect((await pixelAt(page, ...centre)).slice(0, 3)).toEqual([0xd0, 0xd0, 0xd0]);
    expect((await holes(page, 6, 6)).count).toBe(0);
    await page.evaluate(() => (window as unknown as { terrain: { undo(): void } }).terrain.undo());
    await nextFrame(page);
    expect(await pixelAt(page, ...centre)).toEqual(before);
    mkdirSync(`${here}/../../test-results`, { recursive: true });
    await page.locator('canvas').screenshot({ path: `${here}/../../test-results/terrain-${renderer}.png` });
  });
}

// ---- Local review stills: real sheets from the library, Dusk Helm scene layouts, before and after ----------------
const root = fileURLToPath(new URL('../../../../../assets-local/', import.meta.url));
const sheets = `${root}sets/terrain-dualgrid16/2026-11-22/`;
const env = `${root}packs/smallscaleint-fantasy-tileset-2d-isometric/2026-11-01/extracted/Environment/`;
const reviewDir = `${root}review/1204/`;

const hash = (x: number, y: number, s: number) =>
  ((((x * 374761393 + y * 668265263 + s * 2147483647) ^ (x * y * 1274126177)) >>> 0) % 1000) / 1000;
const grid = (size: number, at: (x: number, y: number) => number) =>
  Array.from({ length: size * size }, (_, i) => at(i % size, Math.floor(i / size)));
/** Ground layouts of the five Dusk Helm scenes, as terrain cells (0 dirt, 1 dry grass, 2 grass, 3 dark grass, 4 cobble, 5 paving). */
const SCENES: Record<string, (x: number, y: number) => number> = {
  town: (x, y) => {
    const plaza = Math.abs(x - 6) <= 1 && Math.abs(y - 6) <= 1;
    if (plaza) return 5;
    if (x === 6 || y === 6 || (y === 2 && x > 6)) return 4;
    return hash(x, y, 1) < 0.18 ? 0 : 2;
  },
  field: (x, y) => {
    const route = 6 + Math.round(2 * Math.sin(y * 0.6));
    if (Math.abs(x - route) <= 1) return 0;
    return hash(x, y, 2) < 0.25 ? 1 : 2;
  },
  forest: (x, y) => {
    const d = Math.hypot(x - 6, y - 6);
    if ((x === y || x === y + 1) && d > 2.5) return 0; // a 4-connected path: diagonal-only cells read as beads
    if (d < 2.6 + hash(x, y, 3)) return 2;
    return hash(x, y, 4) < 0.15 ? 2 : 3;
  },
  cave: (x, y) => {
    if (hash(x, y, 5) < 0.2 || Math.hypot(x - 4, y - 8) < 2) return 0;
    return Math.abs(y - 3) <= 0 && x > 2 ? 5 : 4;
  },
  graveyard: (x, y) => {
    if (x === 3 || (y === 9 && x >= 3)) return 5;
    if (x >= 5 && x <= 10 && y >= 2 && y <= 7 && x % 2 === 1 && y % 3 !== 1) return 0;
    return hash(x, y, 6) < 0.4 ? 1 : 2;
  },
};

test.describe('review stills', () => {
  test.skip(!existsSync(sheets) || !existsSync(env), 'terrain sheets or pack art not installed in assets-local');

  for (const [name, at] of Object.entries(SCENES)) {
    test(`${name}: before and after, phone`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 780, height: 1688 },
      });
      const page = await context.newPage();
      await page.route('https://pack.test/**', (route) =>
        route.fulfill({
          body: readFileSync(env + decodeURIComponent(new URL(route.request().url()).pathname.slice(1))),
          contentType: 'image/png',
        }),
      );
      await page.route('https://sheets.test/**', (route) =>
        route.fulfill({
          body: readFileSync(sheets + new URL(route.request().url()).pathname.slice(1)),
          contentType: 'image/png',
        }),
      );
      const tufts = ['A6', 'A7', 'A8', 'A9'].map((id) => `t1:pack/ground-${id.toLowerCase()}`);
      const dry = ['J5', 'J6', 'J8'].map((id) => `t1:pack/ground-${id.toLowerCase()}`);
      const terrains: TerrainSpec[] = TERRAINS.map((terrain) => ({
        ...terrain,
        ...(terrain.id === 'grass' ? { decals: tufts, decalChance: 0.35 } : {}),
        ...(terrain.id === 'dry-grass' ? { decals: dry, decalChance: 0.35 } : {}),
      }));
      const urls: Record<string, string> = Object.fromEntries(
        TERRAINS.map((terrain) => [terrain.sheet, `https://sheets.test/${terrain.sheet.slice('t3:test/'.length)}.png`]),
      );
      const facings: Record<string, Record<string, string>> = {};
      for (const id of [...tufts, ...dry]) {
        const tile = `Ground ${id.slice(-2).toUpperCase()}`;
        urls[id] = `https://pack.test/${encodeURIComponent(tile)}_N.png`;
        facings[id] = Object.fromEntries(['E', 'N', 'W', 'S'].map((f) => [f, `${tile}_${f}.png`]));
      }
      mkdirSync(reviewDir, { recursive: true });
      for (const blocky of [true, false]) {
        await open(page, {
          width: 13,
          height: 13,
          cells: grid(13, at),
          terrains,
          seed: 1204,
          urls,
          facings,
          blocky,
          view: [780, 1688],
        });
        expect((await holes(page, 13, 13)).count).toBe(0);
        await page.screenshot({ path: `${reviewDir}${name}-${blocky ? 'before' : 'after'}.png` });
      }
      await context.close();
    });
  }
});
