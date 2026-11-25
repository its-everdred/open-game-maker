import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import { loadEnv } from '@ogm/config';

import { PREVIEW_PAGE, type View } from './page.js';

const GPU_ARGS = ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

class Semaphore {
  private active = 0;
  private peak = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await operation();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  stats(): { active: number; peak: number } {
    return { active: this.active, peak: this.peak };
  }

  resetPeak(): void {
    this.peak = this.active;
  }
}

const contexts = new Semaphore(2);

export function previewContextStats(reset = false): { active: number; peak: number } {
  const result = contexts.stats();
  if (reset) contexts.resetPeak();
  return result;
}

export type BrowserRenderOptions = {
  software?: boolean;
  executablePath?: string;
};

export type BrowserRenderResult = {
  cells: Buffer[];
  renderer: string;
  software: boolean;
};

type PreviewFiles = { page: string; modules: Record<string, Buffer>; glb: string };

/**
 * Serve the preview page, its modules and the model from a loopback HTTP server. The model is streamed from disk:
 * routing it through Playwright's route.fulfill sent the whole file over the DevTools pipe, and a GLB over Chromium's
 * 100 MB DevTools buffer closed the pipe and hung the render (leartes 122 MB and 140 MB models, core #1353).
 */
async function servePreview(files: PreviewFiles): Promise<{ server: Server; origin: string }> {
  const glbSize = (await stat(files.glb)).size;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(files.page);
      return;
    }
    if (path === '/asset.glb') {
      response.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': glbSize });
      createReadStream(files.glb)
        .on('error', () => response.destroy())
        .pipe(response);
      return;
    }
    const module = files.modules[path];
    if (module) {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(module);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function allowOnly(route: Route, origin: string): Promise<void> {
  if (new URL(route.request().url()).origin === origin) await route.continue();
  else await route.abort('blockedbyclient');
}

async function close(context: BrowserContext | undefined): Promise<void> {
  if (context) await context.close();
}

export async function renderModelViews(
  glb: string,
  views: readonly View[],
  options: BrowserRenderOptions = {},
): Promise<BrowserRenderResult> {
  return contexts.use(async () => {
    const environment = loadEnv('asset-previews', {
      GM_VERIFY_SOFTWARE_GL: { kind: 'bool', default: 'false' },
    });
    const software = options.software ?? environment.GM_VERIFY_SOFTWARE_GL;
    const threePath = fileURLToPath(import.meta.resolve('three'));
    const [three, threeCore, loader, bufferGeometryUtils, skeletonUtils, meshopt] = await Promise.all([
      readFile(threePath),
      readFile(join(dirname(threePath), 'three.core.js')),
      readFile(fileURLToPath(import.meta.resolve('three/examples/jsm/loaders/GLTFLoader.js'))),
      readFile(fileURLToPath(import.meta.resolve('three/examples/jsm/utils/BufferGeometryUtils.js'))),
      readFile(fileURLToPath(import.meta.resolve('three/examples/jsm/utils/SkeletonUtils.js'))),
      readFile(fileURLToPath(import.meta.resolve('three/examples/jsm/libs/meshopt_decoder.module.js'))),
    ]);
    const runtime = await mkdtemp(join(tmpdir(), 'ogm-asset-preview-'));
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let served: { server: Server; origin: string } | undefined;
    try {
      served = await servePreview({
        page: PREVIEW_PAGE,
        glb,
        modules: {
          '/three.module.js': three,
          '/three.core.js': threeCore,
          '/GLTFLoader.js': loader,
          '/utils/BufferGeometryUtils.js': bufferGeometryUtils,
          '/utils/SkeletonUtils.js': skeletonUtils,
          '/meshopt_decoder.module.js': meshopt,
        },
      });
      const origin = served.origin;
      browser = await chromium.launch({
        headless: true,
        args: software ? SOFTWARE_ARGS : GPU_ARGS,
        // Chromium's Unix socket path is limited to 108 bytes; workspace paths can be longer.
        env: { HOME: runtime, PATH: '/usr/bin:/bin', TMPDIR: '/tmp' },
        executablePath: options.executablePath ?? '/usr/bin/chromium',
      });
      context = await browser.newContext({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      let failEarly: (error: Error) => void = () => undefined;
      const earlyError = new Promise<never>((_, reject) => {
        failEarly = reject;
      });
      earlyError.catch(() => undefined);
      page.on('pageerror', (error) => failEarly(error));
      page.on('console', (message) => {
        if (message.type() === 'error') failEarly(new Error(`preview page: ${message.text()}`));
      });
      browser.on('disconnected', () => failEarly(new Error('preview browser disconnected')));
      page.on('requestfailed', (request) =>
        failEarly(new Error(`preview request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)),
      );
      await page.route('**/*', (route) => allowOnly(route, origin));
      await page.goto(`${origin}/`, { waitUntil: 'commit' });
      await Promise.race([
        page.waitForFunction(
          () => {
            const state = (window as unknown as { __assetPreview?: { ready: boolean; error: string } }).__assetPreview;
            return state?.ready === true || Boolean(state?.error);
          },
          undefined,
          { timeout: 60_000 },
        ),
        earlyError,
      ]);
      const state = await page.evaluate(() => {
        const current = (window as unknown as { __assetPreview: { ready: boolean; error: string; renderer: string } })
          .__assetPreview;
        return { error: current.error, renderer: current.renderer };
      });
      if (state.error) throw new Error(state.error);
      const canvas = page.locator('canvas');
      const cells: Buffer[] = [];
      for (const view of views) {
        await page.evaluate((nextView) => {
          const preview = (window as unknown as { __assetPreview: { renderView: (view: string) => void } })
            .__assetPreview;
          preview.renderView(nextView);
        }, view);
        cells.push(await canvas.screenshot({ type: 'png' }));
      }
      return { cells, renderer: state.renderer, software };
    } finally {
      await close(context);
      await browser?.close();
      if (served) await new Promise<void>((resolve) => served?.server.close(() => resolve()));
      await rm(runtime, { recursive: true, force: true });
    }
  });
}
