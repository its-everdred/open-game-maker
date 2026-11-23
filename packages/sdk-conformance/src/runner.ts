import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SDK_PROTOCOL } from '@ogm/contracts/bridge';
import type { SaveData } from '@ogm/contracts/game';
import { acquireSlot, isSoftware, launch, rendererString, serveStatic } from '@ogm/gm-verify';
import { webkit, type Browser } from 'playwright';

import { buildKinds, readBundle } from './build.js';
import { SAFE_INSETS, STILL_VIEWPORTS } from './checks/c07-stills.js';
import { message } from './checks/util.js';
import { loadGame, loadPrevious, readJsonIfPresent, writeRunRecord } from './game-source.js';
import { HOST_HTML } from './host-page/api.js';
import { conformanceReportSchema, type ConformanceReport } from './report.js';
import { bootFailedResults, runChecks } from './runner-checks.js';
import { BrowserSession, type Origins } from './session.js';
import type { CheckContext, CheckResult, OpenOptions } from './types.js';

export type RunOptions = {
  gameDir: string;
  /** Defaults to a new directory under the system temp dir. */
  outDir?: string;
  /** A previous run's out dir: `manifest.json`, `design/`, `save.json`. */
  previousDir?: string;
  softwareGl?: boolean;
  browser?: 'chromium' | 'webkit';
  /** `$XDG_RUNTIME_DIR`, for the host-wide capture semaphore shared with gm-verify. */
  runtimeDir?: string;
};

const HOST_BUNDLE = fileURLToPath(new URL('./host-page/main.js', import.meta.url));

type Closer = () => Promise<void>;

/** Builds, serves and mounts a game, runs C1–C11 and writes `<out>/conformance.json`. */
export async function runConformance(options: RunOptions): Promise<ConformanceReport & { outDir: string }> {
  const startedAt = new Date();
  const gameDir = resolve(options.gameDir);
  const outDir = resolve(options.outDir ?? (await mkdtemp(join(tmpdir(), 'gm-sdk-'))));
  await mkdir(join(outDir, '.host'), { recursive: true });
  const closers: Closer[] = [];
  const slot = await acquireSlot({ runtimeDir: options.runtimeDir });
  closers.push(async () => slot.release());
  let renderer = 'unknown';
  let manifestId = 'unknown';
  let checks: CheckResult[];
  try {
    /* Read before this run rewrites `<out>`: `--previous` may be the same directory as `--out`. */
    const previous = options.previousDir ? await loadPrevious(resolve(options.previousDir)) : undefined;
    /* C3 rewrites it; a stale one from an earlier run in the same --out must not become a later --previous. */
    await rm(join(outDir, 'save.json'), { force: true });
    const game = await loadGame(gameDir, join(outDir, '.host'));
    manifestId = game.manifest.id;
    await writeRunRecord(outDir, game);
    const saveFixture = await readJsonIfPresent<SaveData<unknown>>(join(gameDir, 'tests/fixtures/save.previous.json'));

    const browser: Browser =
      options.browser === 'webkit' ? await webkit.launch({ headless: true }) : await launch(!!options.softwareGl);
    closers.push(() => browser.close());
    const probe = await browser.newPage();
    renderer = await rendererString(probe);
    await probe.close();

    checks = await (async () => {
      let builds;
      try {
        builds = await buildKinds(gameDir, outDir);
      } catch (error) {
        return bootFailedResults(`build failed: ${message(error)}`);
      }
      await copyFile(HOST_BUNDLE, join(outDir, '.host/main.js'));
      await writeFile(join(outDir, '.host/index.html'), HOST_HTML);
      const servers = await Promise.all([
        serveStatic(join(outDir, '.host')),
        serveStatic(builds.test, { game: true }),
        serveStatic(builds.published, { game: true }),
      ]);
      for (const server of servers) closers.push(() => server.close());
      const origins: Origins = { host: servers[0].url, games: { test: servers[1].url, published: servers[2].url } };
      const open = (overrides: Partial<OpenOptions> = {}) =>
        BrowserSession.open(browser, origins, {
          build: 'test',
          capabilities: game.manifest.capabilities,
          viewport: STILL_VIEWPORTS[0]!.size,
          safe: SAFE_INSETS,
          ...overrides,
        });
      try {
        await (await open()).close();
      } catch (error) {
        return bootFailedResults(message(error));
      }
      const ctx: CheckContext = {
        game,
        open,
        previous,
        saveFixture,
        publishedBundle: await readBundle(builds.published),
        outDir,
      };
      return runChecks(ctx);
    })();
  } catch (error) {
    checks = bootFailedResults(message(error));
  } finally {
    for (const close of closers.reverse()) await close().catch(() => undefined);
  }

  const report = conformanceReportSchema.parse({
    sdkProtocol: SDK_PROTOCOL,
    renderer,
    gl: isSoftware(renderer) || renderer === 'no WebGL' ? 'software' : 'gpu',
    game: { dir: gameDir, manifestId },
    checks,
    stills: checks.flatMap((check) => check.artifacts ?? []).filter((path) => path.endsWith('.png')),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
  });
  await writeFile(join(outDir, 'conformance.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, outDir };
}
