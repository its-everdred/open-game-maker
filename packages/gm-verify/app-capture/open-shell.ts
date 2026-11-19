/** Opens a local game build inside the real web app with mocked sign-in, the way a player reaches it. */
import { resolve } from 'node:path';
import type { Browser, BrowserContext, Frame, Page } from 'playwright';
import type { DesignDoc } from '@ogm/contracts/browser';
import { installAuthRoutes } from '../../../apps/web/e2e/fixtures/auth-routes';
import { buildId, installGameApi } from '../../../apps/web/e2e/support/mock-game-api';
import { captureUrlFile } from '../../../apps/web/e2e/support/shell-capture-files';
import { gameHeaders } from '../../../services/games-host/src/headers';

export { buildId };

export interface ShellOptions {
  /** A local build directory, or a hosted build's URL (ending in `/`) whose files are fetched as the game asks. */
  game: { dist: string } | { url: string };
  /** The static server holding the bundled web app. */
  server: { url: string };
  /** The bundled web app directory the server serves. */
  web: string;
  design: DesignDoc;
  title: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  /** Record the page into this directory. */
  videoDir?: string;
  /** Also collect the game frame's console errors, from its first script on. */
  gameConsole?: boolean;
  /** Install capture instrumentation before any page script runs. */
  initScript?: () => void;
}

export interface OpenShell {
  context: BrowserContext;
  page: Page;
  /** Page errors, missing game files and (with `gameConsole`) game console errors, in order. */
  errors: string[];
}

/** Opens the shell at one viewport and waits for the game bridge; the caller closes `context`. */
export async function openShell(browser: Browser, options: ShellOptions): Promise<OpenShell> {
  const { width, height } = options;
  const size = `${width}x${height}`;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: options.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    ...(options.videoDir ? { recordVideo: { dir: options.videoDir, size: { width, height } } } : {}),
  });
  try {
    if (options.initScript) await context.addInitScript(options.initScript);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (options.gameConsole)
      page.on('console', (message) => {
        if (message.type() === 'error' && message.location().url.includes(`/${buildId}/`))
          errors.push(`console: ${message.text().slice(0, 200)}`);
      });
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page, options.design, options.title);
    // The real web build expects this games origin; intercept it without opening a listener.
    await page.route('http://127.0.0.1:10000/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const suffix = path.includes(`/${buildId}/`) ? path.split(`/${buildId}/`)[1]! : path.slice(1);
      const headers = gameHeaders(new URL(options.server.url).origin);
      if ('url' in options.game) {
        const target = new URL(suffix || 'index.html', options.game.url);
        if (!target.href.startsWith(options.game.url)) return route.abort();
        const response = await route.fetch({ url: target.href }).catch(() => null);
        if (!response?.ok()) {
          errors.push(`game resource missing: ${path}`);
          return route.abort();
        }
        return route.fulfill({ response, headers: { ...response.headers(), ...headers } });
      }
      const file = captureUrlFile(options.game.dist, suffix || 'index.html');
      if (!file) {
        errors.push(`game resource missing: ${path}`);
        return route.abort();
      }
      await route.fulfill({ path: file, headers });
    });
    await page.route(`${options.server.url}g/game**`, (route) =>
      route.fulfill({ path: resolve(options.web, 'index.html'), contentType: 'text/html' }),
    );
    const entry = page.waitForResponse((response) => response.url().includes(`/${buildId}/index.html`), {
      timeout: 30_000,
    });
    await page.goto(new URL('g/game?test=1', options.server.url).href);
    console.error(`shell capture: waiting for game entry at ${size}`);
    const response = await entry;
    if (!response.ok()) throw new Error(`game entry failed: ${response.status()}`);
    await page.locator('.game-frame iframe').waitFor({ state: 'visible', timeout: 30_000 });
    const state = await page.waitForFunction(
      () => {
        const host = (window as unknown as { __ogmHost?: { game?: { bridgeState?: string } } }).__ogmHost;
        const status = host?.game?.bridgeState;
        return status === 'ready' || status === 'error' ? status : false;
      },
      null,
      { timeout: 30_000 },
    );
    if ((await state.jsonValue()) !== 'ready') throw new Error('game bridge did not become ready');
    console.error(`shell capture: game ready at ${size}`);
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The game's own frame inside the shell. */
export function gameFrame(page: Page): Frame | undefined {
  return page.frames().find((item) => item.url().includes(`/${buildId}/index.html`));
}
