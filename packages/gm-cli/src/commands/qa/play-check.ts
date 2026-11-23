import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import {
  changedShare,
  firstTapPath,
  frameStddev,
  gameApiAnswer,
  installPlayTrace,
  judgePlay,
  moveKey,
  sawFirstFrame,
  type PlayInput,
  type PlayManifest,
  type PlayObservation,
  type PlayTraceEntry,
} from '../../qa-play-check.js';
import { niceCapture } from '../run/index.js';
import { readEnvFile } from '../publish/index.js';

/*
 * The games host is a tailnet address and the app a public one: desktop Chromium's Local Network Access check blocks
 * that iframe, which a phone's browser does not. The check plays as the phone does.
 */
type Page = Awaited<ReturnType<Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>['newPage']>>;

const BROWSER_ARGS = ['--disable-features=LocalNetworkAccessChecks'];
/* Blobs reports its first frame about 50 s in on the host under load; leave room before calling a boot failed. */
const BOOT_MS = 110_000;

export const command: GmCommand = {
  name: 'qa play-check',
  summary: 'play a published build in the production app shell at 390x844: first frame, tap path, one input',
  usage: '<game id> <build id> --out <dir> [--web-dist <dir>] [--timeout 170]',
  example: 'qa play-check g_123 build_456 --out assets-local/review/app/play-check/blobs',
  flags: {
    out: { type: 'string', help: 'stills and play-check.json' },
    'web-dist': { type: 'string', help: "serve the shell from this web build instead of production's (replays)" },
    timeout: { type: 'number', default: 170, help: 'total timeout in seconds' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('a game id and a build id are required', 'gm help qa play-check');
    const [gameId, buildId] = args as [string, string];
    if (![gameId, buildId].every((id) => /^[A-Za-z0-9_-]+$/u.test(id)))
      throw new UsageError('invalid game or build id', 'gm help qa play-check');
    if (typeof flags.out !== 'string') throw new UsageError('--out is required', 'gm help qa play-check');
    const timeout = flags.timeout as number;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError('invalid timeout', 'gm help qa play-check');
    const webDist = typeof flags['web-dist'] === 'string' ? resolve(ctx.cwd, flags['web-dist']) : undefined;
    if (webDist && !existsSync(join(webDist, 'index.html')))
      throw new UsageError('--web-dist has no index.html', 'gm help qa play-check');

    const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
    const api = readEnvFile(join(envDir, 'api.env'));
    const app = api.OGM_APP_ORIGIN?.replace(/\/$/u, '');
    const games = api.OGM_GAMES_ORIGIN?.replace(/\/$/u, '');
    if (!app || !games || !URL.canParse(app) || !URL.canParse(games)) {
      ctx.err(`qa play-check: OGM_APP_ORIGIN and OGM_GAMES_ORIGIN must be set in ${envDir}/api.env`);
      return EXIT.failed;
    }
    const qa = readEnvFile(join(envDir, 'qa.env'));
    if (!(qa.OGM_QA_SESSION_COOKIE_NAME && qa.OGM_QA_SESSION_COOKIE)) {
      ctx.err(`qa play-check: missing the QA session in ${envDir}/qa.env; run ops/bin/ogm-qa-session`);
      return EXIT.failed;
    }
    if (qa.OGM_QA_SESSION_EXPIRES && Date.parse(qa.OGM_QA_SESSION_EXPIRES) <= Date.now()) {
      ctx.err('qa play-check: the QA session expired; run ops/bin/ogm-qa-session');
      return EXIT.failed;
    }

    const build = `${games}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/`;
    const fetched = await Promise.all(
      ['manifest.json', 'design/design.json'].map(async (name) => {
        const response = await fetch(new URL(name, build)).catch(() => null);
        return response?.ok ? ((await response.json()) as unknown) : null;
      }),
    );
    const [manifest, doc] = fetched as [PlayManifest | null, unknown];
    const out = resolve(ctx.cwd, flags.out);
    mkdirSync(out, { recursive: true });
    const report = (observation: PlayObservation, errors: string[]) => {
      const verdict = judgePlay(observation);
      writeFileSync(
        join(out, 'play-check.json'),
        `${JSON.stringify({ gameId, buildId, viewport: '390x844', ...verdict, observation, errors }, null, 2)}\n`,
      );
      const shown = relative(ctx.cwd, out) || '.';
      if (ctx.json) printJson(ctx, { verdict: verdict.failures.length ? 'fail' : 'pass', out: shown, ...verdict });
      else {
        for (const line of verdict.failures) ctx.out(`fail: ${line}`);
        for (const line of verdict.unchecked) ctx.out(`unchecked: ${line}`);
        ctx.out(`${verdict.failures.length ? 'fail' : 'pass'}: stills and trace in ${shown}`);
      }
      return verdict.failures.length ? EXIT.failed : EXIT.ok;
    };
    const observation: PlayObservation = {
      bridgeState: undefined,
      trace: [],
      bootMs: null,
      tryAgain: false,
      tapPath: manifest ? firstTapPath(manifest) : [],
      frameStddev: null,
      idleChange: null,
      inputChange: null,
      input: null,
    };
    if (!manifest || !doc) {
      observation.bridgeState = 'not started: the build serves no manifest.json or design/design.json';
      return report(observation, []);
    }

    const verify = await import('@ogm/gm-verify');
    niceCapture();
    const abort = new AbortController();
    const slot = await verify.acquireSlot({ runtimeDir: ctx.config.runtimeDir, signal: abort.signal });
    // The play time starts once this check holds the capture slot; waiting for another capture is not play.
    const deadline = Date.now() + timeout * 1000;
    const left = (cap: number) => Math.max(1_000, Math.min(cap, deadline - Date.now()));
    const errors: string[] = [];
    const started = Date.now();
    const progress = (line: string) => ctx.err(`play-check ${Math.round((Date.now() - started) / 1000)}s: ${line}`);
    const browser = await verify.launch(ctx.config.verifySoftwareGl, false, true, BROWSER_ARGS);
    // Past the deadline the browser closes, every pending step throws, and the report still gets written.
    const stop = setTimeout(() => {
      observation.stopped = `over ${timeout} s`;
      void browser.close();
    }, deadline - Date.now());
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        // The route below must see the shell's API calls; a service worker would answer some of them itself.
        serviceWorkers: 'block',
      });
      await context.addCookies([{ name: qa.OGM_QA_SESSION_COOKIE_NAME, value: qa.OGM_QA_SESSION_COOKIE, url: app }]);
      await context.addInitScript(installPlayTrace);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
      const prefix = `/api/v1/games/${gameId}`;
      const title = manifest.title ?? gameId;
      await page.route(`${app}/api/v1/games/${gameId}**`, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path !== prefix && !path.startsWith(`${prefix}/`)) return route.continue();
        const answer = gameApiAnswer({
          gameId,
          buildId,
          title,
          doc,
          method: request.method(),
          path: path.slice(prefix.length),
        });
        return route.fulfill({
          status: answer.status,
          ...(answer.body === undefined ? {} : { contentType: 'application/json', body: JSON.stringify(answer.body) }),
        });
      });
      if (webDist) await serveShell(page, app, webDist);

      const opened = Date.now();
      progress('opening the game');
      await page.goto(`${app}/g/${encodeURIComponent(gameId)}?test=1`, { timeout: left(30_000) });
      const state = () =>
        page
          .evaluate(() => {
            const host = (window as unknown as { __ogmHost?: { game?: { bridgeState?: string } } }).__ogmHost;
            return {
              bridge: host?.game?.bridgeState,
              trace: (window as unknown as { __playTrace?: PlayTraceEntry[] }).__playTrace ?? [],
            };
          })
          .catch(() => ({ bridge: undefined, trace: [] as PlayTraceEntry[] }));
      const tryAgain = page.getByRole('button', { name: 'Try again' });
      // Boot: the bridge is ready, the game has drawn, and its load finished (or never reports one).
      const bootEnd = Date.now() + left(BOOT_MS);
      let errorSince: number | undefined;
      let frameAt: number | undefined;
      for (;;) {
        const now = await state();
        observation.bridgeState = now.bridge;
        observation.trace = now.trace;
        if (sawFirstFrame(now.trace)) frameAt ??= Date.now();
        const done = now.trace.some((entry) => entry.dir === 'in' && entry.t === 'load.done');
        if (now.bridge === 'ready' && frameAt !== undefined && (done || Date.now() - frameAt > 15_000)) break;
        // A stall the shell recovers from is fine (#1267); an error that holds for 30 s is what a player sees.
        errorSince = now.bridge === 'error' ? (errorSince ?? Date.now()) : undefined;
        if (errorSince !== undefined && Date.now() - errorSince > 30_000) break;
        if (Date.now() > bootEnd) break;
        await page.waitForTimeout(500);
      }
      progress(
        `boot ended: bridge ${observation.bridgeState ?? 'none'}, first frame ${frameAt === undefined ? 'none' : `${Math.round((frameAt - opened) / 1000)}s`}`,
      );
      await page.screenshot({ path: join(out, 'play.png'), scale: 'css' }).catch(() => undefined);
      if (observation.bridgeState === 'ready' && frameAt !== undefined) {
        observation.bootMs = frameAt - opened;
        const game = page.frameLocator('.game-frame iframe');
        for (const text of observation.tapPath) {
          progress(`tap ${text}`);
          try {
            await game
              .getByText(text, { exact: true })
              .first()
              .tap({ timeout: left(30_000) });
            await page.waitForTimeout(1_200);
          } catch {
            observation.tapFailed = text;
            break;
          }
        }
        await page.waitForTimeout(3_000);
        const frame = await page.locator('.game-frame').boundingBox();
        if (frame && observation.tapFailed === undefined) {
          const shot = () => page.screenshot({ clip: frame, scale: 'css', timeout: left(20_000) });
          const before = await shot();
          writeFileSync(join(out, 'ingame.png'), before);
          observation.frameStddev = await frameStddev(before);
          await page.waitForTimeout(800);
          const idle = await shot();
          observation.idleChange = await changedShare(before, idle);
          const stick = await page
            .locator('[data-stick="move"]')
            .first()
            .boundingBox()
            .catch(() => null);
          const key = moveKey(manifest);
          const input: PlayInput = stick ? 'stick' : key ? 'key' : 'swipe';
          const touch = await context.newCDPSession(page);
          if (input === 'key') await page.keyboard.down(key!);
          else {
            const from = stick
              ? { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 }
              : { x: frame.x + frame.width / 2 - 40, y: frame.y + frame.height / 2 };
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
            for (let step = 1; step <= 8; step += 1) {
              await touch.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: from.x + step * 10, y: from.y }],
              });
              await page.waitForTimeout(16);
            }
          }
          // Hold the input as long as the idle wait lasted, so both comparisons span the same time.
          await page.waitForTimeout(input === 'key' ? 800 : 670);
          const moved = await shot();
          if (input === 'key') await page.keyboard.up(key!);
          else await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          writeFileSync(join(out, 'input.png'), moved);
          observation.input = input;
          observation.inputChange = await changedShare(idle, moved);
          progress(`${input}: idle ${observation.idleChange.toFixed(3)}, input ${observation.inputChange.toFixed(3)}`);
        }
      }
      const final = await state();
      observation.bridgeState = final.bridge;
      observation.trace = final.trace;
      observation.tryAgain = await tryAgain.isVisible().catch(() => false);
      await page.screenshot({ path: join(out, 'end.png'), scale: 'css' }).catch(() => undefined);
      await context.close();
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      errors.push(`check: ${message}`);
      observation.stopped ??= message;
    } finally {
      clearTimeout(stop);
      await browser.close();
      slot.release();
    }
    return report(observation, errors);
  },
};

/** Serve the shell's own files from a local web build; the API and auth still go to production. */
async function serveShell(page: Page, app: string, dist: string): Promise<void> {
  const root = resolve(dist);
  await page.route(`${app}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.startsWith('/api/') || path.startsWith('/auth/')) return route.fallback();
    const file = resolve(root, `.${path}`);
    if (file.startsWith(`${root}${sep}`) && existsSync(file) && statSync(file).isFile())
      return route.fulfill({ path: file });
    if (route.request().resourceType() === 'document') return route.fulfill({ path: join(root, 'index.html') });
    return route.continue();
  });
}
