import type { Tier, ViewId } from '@ogm/contracts';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Frame,
  type Page,
} from 'playwright';

import { ConsoleCollector } from './console.js';
import { HookDriver } from './hooks.js';
import { SOFTWARE_RENDERER, type ViewportName } from './report.js';

export const GPU_ARGS = ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'];
export const SOFTWARE_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const READY_TIMEOUT_MS = 180_000;

export const VIEWPORTS: Record<ViewportName, BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'phone-landscape': { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'tablet-landscape': { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export function isSoftware(renderer: string): boolean {
  return SOFTWARE_RENDERER.test(renderer);
}

export function launch(software: boolean): Promise<Browser> {
  return chromium.launch({ headless: true, args: software ? SOFTWARE_ARGS : GPU_ARGS });
}

/** The WebGL `UNMASKED_RENDERER_WEBGL` string of this page's GPU process. */
export async function rendererString(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = (document.createElement('canvas').getContext('webgl2') ??
      document.createElement('canvas').getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'no WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
}

/** `?build=test&capture=1&tier=` on top of the caller's query. */
export function gameUrl(url: string, tier: Tier): string {
  const target = new URL(url);
  target.searchParams.set('build', 'test');
  target.searchParams.set('capture', '1');
  target.searchParams.set('tier', tier);
  return target.href;
}

/**
 * The shell a run captures the game in: a page that mounts the game in an iframe on another origin. Either the host
 * frame (`hostFrameUrl`, the build served as its own games origin), or the signed-in app's `/play/<slug>` page with
 * `storageState`, where every request the app makes for a game build (`/g/<gameId>/<buildId>/<file>` on the games
 * origin) is answered from `localUrl`, the local build. Either way the stills show the top bar, Pause and touch overlay
 * around the build under test.
 */
export type AppFrame = {
  /** The shell page: the host frame, or `https://<app origin>/play/<slug>`. */
  url: string;
  /** The real app only: a Playwright storage state of a signed-in account (ops/bin/ogm-qa-signin on the host). */
  storageState?: string;
  /** The real app only: the loopback server of the local build, which stands in for the games origin. */
  localUrl?: string;
};

/** The host frame page for a local build served at `gamesUrl`; the shell passes that URL's query on to the game. */
export function hostFrameUrl(shellUrl: string, gamesUrl: string, tier: Tier, title: string): string {
  const url = new URL('host-shell.html', shellUrl);
  url.searchParams.set('games', gamesUrl);
  url.searchParams.set('tier', tier);
  url.searchParams.set('title', title);
  return url.href;
}

/** A game build file on the games origin: `/g/<gameId>/<buildId>/<file>`. The app's own `/g/<gameId>` page has no file. */
export const GAME_FILE = /^\/g\/[^/]+\/[^/]+\/(.*)$/;

/**
 * Serves the games origin from the local build: `/g/<gameId>/<buildId>/<file>` is `<file>`, and once that origin is
 * known any other path on it (a test build loads `/assets/...` from the root) is the same path in the local build.
 */
async function routeGameToLocal(context: BrowserContext, app: AppFrame & { localUrl: string }): Promise<void> {
  const appOrigin = new URL(app.url).origin;
  let gamesOrigin: string | undefined;
  await context.route(
    (url) => url.origin !== appOrigin && (GAME_FILE.test(url.pathname) || url.origin === gamesOrigin),
    async (route) => {
      const url = new URL(route.request().url());
      const file = GAME_FILE.exec(url.pathname)?.[1];
      if (file !== undefined) gamesOrigin = url.origin;
      const path = file ?? url.pathname.slice(1);
      const local = new URL(path === '' ? 'index.html' : path, app.localUrl);
      local.search = url.search;
      const response = await fetch(local);
      await route.fulfill({
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' },
        body: Buffer.from(await response.arrayBuffer()),
      });
    },
  );
}

/**
 * Before the game's scripts run, its frame's address gains the capture parameters (`gameUrl`), so the SDK installs the
 * test hooks inside the app shell too. The app frame itself is left alone.
 */
function captureParams({ appOrigin, tier }: { appOrigin: string; tier: Tier }): void {
  const here = new URL(location.href);
  if (here.origin === appOrigin || !/^\/g\/[^/]+\/[^/]+\//.test(here.pathname)) return;
  here.searchParams.set('build', 'test');
  here.searchParams.set('capture', '1');
  here.searchParams.set('tier', tier);
  history.replaceState(history.state, '', here.href);
}

/** The game's frame inside the app shell, once the app has mounted it. */
async function gameFrame(page: Page, appOrigin: string, timeoutMs: number): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = page.frames().find((candidate) => {
      try {
        const url = new URL(candidate.url());
        return url.origin !== appOrigin && GAME_FILE.test(url.pathname);
      } catch {
        return false;
      }
    });
    if (frame) return frame;
    if (Date.now() >= deadline) {
      const signIn = await page
        .getByText(/sign in/i)
        .first()
        .isVisible()
        .catch(() => false);
      throw new Error(
        signIn
          ? `the app showed Sign in at ${page.url()}: the storage state is signed out; mint a new one with ops/bin/ogm-qa-signin`
          : `the app at ${page.url()} mounted no game frame within ${timeoutMs} ms`,
      );
    }
    await page.waitForTimeout(200);
  }
}

export type OpenGameOptions = {
  viewport: ViewportName;
  tier: Tier;
  rig?: ViewId;
  /** Shared across viewports so one report counts each message once per occurrence. */
  console?: ConsoleCollector;
  readyTimeoutMs?: number;
  contextOptions?: BrowserContextOptions;
  /** Capture inside the app shell instead of the bare game page. */
  app?: AppFrame;
};

export type OpenedGame = {
  page: Page;
  /** The page or, inside the app shell, the game's frame: where the hooks and the canvas live. */
  game: Page | Frame;
  hooks: HookDriver;
  renderer: string;
  software: boolean;
  console: ConsoleCollector;
  close(): Promise<void>;
};

/**
 * Opens the game at `url` in a fresh context and waits for `window.__gm.ready` (or the `__ready` alias). A page error
 * before ready rejects at once with its text instead of waiting out the timeout (the capture.mjs rule).
 */
export async function openGame(browser: Browser, url: string, options: OpenGameOptions): Promise<OpenedGame> {
  const app = options.app;
  const context = await browser.newContext({
    ...VIEWPORTS[options.viewport],
    ...options.contextOptions,
    ...(app?.storageState ? { storageState: app.storageState } : {}),
    /* A service worker would answer game requests before the local-build route sees them. */
    ...(app?.localUrl ? { serviceWorkers: 'block' as const } : {}),
  });
  if (app?.localUrl) {
    await routeGameToLocal(context, { ...app, localUrl: app.localUrl });
    await context.addInitScript(captureParams, { appOrigin: new URL(app.url).origin, tier: options.tier });
  }
  const page = await context.newPage();
  const collector = options.console ?? new ConsoleCollector();
  let failEarly: (error: Error) => void = () => {};
  const early = new Promise<never>((_, reject) => {
    failEarly = reject;
  });
  early.catch(() => {});
  let ready = false;
  page.on('pageerror', (error) => {
    collector.add('error', error.message);
    if (!ready) failEarly(new Error(`page failed before ready: ${error.message}`));
  });
  page.on('console', (message) => {
    const type = message.type();
    /* Our own doing: the app shell's service worker is blocked so the local-build route sees every request. */
    if (app?.localUrl && message.text() === 'Service Worker registration blocked by Playwright') return;
    if (type === 'error') collector.add('error', message.text());
    else if (type === 'warning') collector.add('warning', message.text());
  });
  const timeout = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  try {
    await Promise.race([
      page.goto(app ? app.url : gameUrl(url, options.tier), { waitUntil: 'commit', timeout }),
      early,
    ]);
    const game = app ? await Promise.race([gameFrame(page, new URL(app.url).origin, timeout), early]) : page;
    await Promise.race([
      game.waitForFunction(
        () => {
          const w = window as unknown as { __gm?: { ready?: boolean }; __ready?: boolean };
          return w.__gm?.ready === true || w.__ready === true;
        },
        null,
        { timeout, polling: 100 },
      ),
      early,
    ]);
    ready = true;
    const renderer = await rendererString(page);
    const hooks = await HookDriver.attach(page, options.rig, game);
    return {
      page,
      game,
      hooks,
      renderer,
      software: isSoftware(renderer) || renderer === 'no WebGL',
      console: collector,
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
