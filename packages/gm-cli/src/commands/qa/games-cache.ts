import { homedir } from 'node:os';
import { join } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { withBrowser } from '../../qa.js';
import {
  buildGamesCacheReport,
  buildAfterPublishReport,
  matchesConfiguredOrigin,
  type BuildCacheEntry,
  type CacheRun,
  type ResourceSample,
} from '../../qa-games-cache.js';
import { readEnvFile } from '../publish/index.js';

type ImageProbe = { url: string } | null;
type NetworkSample = {
  url: string;
  status: number;
  cacheControl: string | null;
  fromCache: boolean;
  transferSize: number;
  duration: number;
};

export const command: GmCommand = {
  name: 'qa games-cache',
  summary: 'measure the games-list logo, thumbnail and API on a same-session second load',
  usage: '[--origin <app origin>] [--game <slug>] [--after-publish <buildId>] [--json]',
  example: 'qa games-cache --origin https://app.example.com --game blobs --json',
  flags: {
    origin: { type: 'string', help: 'production app origin (default OGM_APP_ORIGIN in api.env)' },
    game: { type: 'string', default: 'blobs', help: 'game slug to measure (default: blobs)' },
    'after-publish': { type: 'string', help: 'compare this published build with the previous build' },
  },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa games-cache');
    const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
    const api = readEnvFile(join(envDir, 'api.env'));
    const configuredOrigin = api.OGM_APP_ORIGIN ?? ctx.env?.OGM_APP_ORIGIN;
    const origin = (flags.origin as string | undefined)?.replace(/\/$/u, '') ?? configuredOrigin;
    const game = flags.game as string;
    if (!origin)
      throw new UsageError(
        'provide --origin or configure OGM_APP_ORIGIN',
        'gm qa games-cache --origin https://app.example.com',
      );
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new UsageError('--origin must be an HTTP(S) URL', 'gm help qa games-cache');
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new UsageError('--origin must be an HTTP(S) URL', 'gm help qa games-cache');
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password)
      throw new UsageError('--origin must be an origin without a path or credentials', 'gm help qa games-cache');
    if (!matchesConfiguredOrigin(origin, configuredOrigin))
      throw new UsageError(
        '--origin must match OGM_APP_ORIGIN in api.env to protect the QA session',
        'gm help qa games-cache',
      );

    const qa = readEnvFile(join(envDir, 'qa.env'));
    if (!(qa.OGM_QA_SESSION_COOKIE_NAME && qa.OGM_QA_SESSION_COOKIE)) {
      ctx.err(`qa games-cache: missing the QA session in ${envDir}/qa.env; run ops/bin/ogm-qa-session on the QA host`);
      return EXIT.failed;
    }
    if (qa.OGM_QA_SESSION_EXPIRES && Date.parse(qa.OGM_QA_SESSION_EXPIRES) <= Date.now()) {
      ctx.err('qa games-cache: the QA session expired; run ops/bin/ogm-qa-session');
      return EXIT.failed;
    }

    const report = await withBrowser(ctx, async (browser) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await context.addCookies([
          {
            name: qa.OGM_QA_SESSION_COOKIE_NAME!,
            value: qa.OGM_QA_SESSION_COOKIE!,
            url: parsed.origin,
          },
        ]);
        const started = new Map<string, { url: string; timestamp: number }>();
        const networkByRequest = new Map<string, NetworkSample>();
        const networkByUrl = new Map<string, NetworkSample[]>();
        const cacheServed = new Set<string>();
        cdp.on(
          'Network.requestWillBeSent',
          (event: { requestId: string; timestamp: number; request: { url: string } }) => {
            started.set(event.requestId, { url: event.request.url, timestamp: event.timestamp });
          },
        );
        cdp.on('Network.requestServedFromCache', (event: { requestId: string }) => cacheServed.add(event.requestId));
        cdp.on(
          'Network.responseReceived',
          (event: {
            requestId: string;
            timestamp: number;
            response: {
              url: string;
              status: number;
              headers: Record<string, string>;
              fromDiskCache?: boolean;
              fromServiceWorker?: boolean;
            };
          }) => {
            const start = started.get(event.requestId);
            const cacheControl = Object.entries(event.response.headers).find(
              ([name]) => name.toLowerCase() === 'cache-control',
            )?.[1];
            const value: NetworkSample = {
              url: event.response.url,
              status: event.response.status,
              cacheControl: typeof cacheControl === 'string' ? cacheControl : null,
              fromCache: Boolean(
                event.response.fromDiskCache || event.response.fromServiceWorker || cacheServed.has(event.requestId),
              ),
              transferSize: 0,
              duration: start ? (event.timestamp - start.timestamp) * 1000 : 0,
            };
            networkByRequest.set(event.requestId, value);
            const samples = networkByUrl.get(value.url) ?? [];
            samples.push(value);
            networkByUrl.set(value.url, samples);
          },
        );
        cdp.on(
          'Network.loadingFinished',
          (event: { requestId: string; timestamp: number; encodedDataLength: number }) => {
            const value = networkByRequest.get(event.requestId);
            const start = started.get(event.requestId);
            if (value) {
              value.transferSize = event.encodedDataLength;
              if (start) value.duration = (event.timestamp - start.timestamp) * 1000;
            }
          },
        );
        const waitForList = async () => {
          const label = new RegExp(game.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
          const tile = page.getByRole('button', { name: label }).first();
          await tile.waitFor({ state: 'visible', timeout: 30_000 });
          await tile.scrollIntoViewIfNeeded();
          await page.waitForFunction(
            (slug) => {
              const target = [...document.querySelectorAll<HTMLElement>('.game-tile')].find((el) =>
                `${el.getAttribute('aria-label') ?? ''} ${el.innerText}`.toLowerCase().includes(slug.toLowerCase()),
              );
              const images = [...(target?.querySelectorAll<HTMLImageElement>('img') ?? [])];
              return images.length >= 2 && images.every((image) => image.complete && image.naturalWidth > 0);
            },
            game,
            { timeout: 30_000 },
          );
          await page.waitForTimeout(500);
          return page.evaluate((slug) => {
            const target = [...document.querySelectorAll<HTMLElement>('.game-tile')].find((el) =>
              `${el.getAttribute('aria-label') ?? ''} ${el.innerText}`.toLowerCase().includes(slug.toLowerCase()),
            );
            const images = [...(target?.querySelectorAll<HTMLImageElement>('img') ?? [])];
            const imageUrl = (className: string) => {
              const image = images.find((candidate) => candidate.className.split(/\s+/u).includes(className));
              return image?.currentSrc || image?.src || null;
            };
            const selected = { logo: imageUrl('game-logo'), thumbnail: imageUrl('game-cover-image') };
            return {
              logo: selected.logo ? { url: selected.logo } : null,
              thumbnail: selected.thumbnail ? { url: selected.thumbnail } : null,
              api: (() => {
                const entry = performance
                  .getEntriesByType('resource')
                  .filter((item) => /\/api\/v1\/games(?:\?|$)/u.test(item.name))
                  .at(-1);
                return entry ? { url: entry.name } : null;
              })(),
            };
          }, game);
        };

        const afterPublish = flags['after-publish'] as string | undefined;
        if (afterPublish) {
          const gamesOrigin = api.OGM_GAMES_ORIGIN ?? ctx.env?.OGM_GAMES_ORIGIN;
          if (!gamesOrigin) throw new UsageError('configure OGM_GAMES_ORIGIN in api.env', 'check api.env');
          let gamesUrl: URL;
          try {
            gamesUrl = new URL(gamesOrigin);
          } catch {
            throw new UsageError('OGM_GAMES_ORIGIN must be an HTTP(S) URL', 'check api.env');
          }
          if (!['http:', 'https:'].includes(gamesUrl.protocol) || gamesUrl.username || gamesUrl.password)
            throw new UsageError('OGM_GAMES_ORIGIN must be an HTTP(S) URL without credentials', 'check api.env');
          await page.goto(`${origin}/games`, { waitUntil: 'networkidle', timeout: 60_000 });
          const builds = await page.evaluate(async (slug) => {
            const gamesResponse = await fetch('/api/v1/games');
            if (!gamesResponse.ok) throw new Error(`games list returned HTTP ${gamesResponse.status}`);
            const gamesBody = (await gamesResponse.json()) as { games?: Array<{ id: string; slug: string }> };
            const selected = gamesBody.games?.find((item) => item.slug === slug);
            if (!selected) throw new Error(`game "${slug}" was not found in the games list`);
            const buildsResponse = await fetch(`/api/v1/games/${encodeURIComponent(selected.id)}/builds`);
            if (!buildsResponse.ok) throw new Error(`build list returned HTTP ${buildsResponse.status}`);
            const body = (await buildsResponse.json()) as {
              builds?: Array<{ id: string; status: string; artifact: string }>;
            };
            return {
              gameId: selected.id,
              builds: (body.builds ?? []).filter((build) => build.status === 'tested' && build.artifact === 'present'),
            };
          }, game);
          const targetIndex = builds.builds.findIndex((build) => build.id === afterPublish);
          if (targetIndex < 1)
            throw new UsageError(`build ${afterPublish} has no preceding tested build`, 'publish another build first');
          const previousBuildId = builds.builds[targetIndex - 1]!.id;
          const readPlan = async (buildId: string): Promise<BuildCacheEntry[]> => {
            const url = new URL(
              `/g/${encodeURIComponent(builds.gameId)}/${encodeURIComponent(buildId)}/assets/cache-plan.json`,
              gamesUrl,
            );
            const response = await context.request.get(url.toString(), { timeout: 30_000 });
            if (!response.ok()) throw new Error(`cache plan for ${buildId} returned HTTP ${response.status()}`);
            const plan = (await response.json()) as {
              entries?: Array<{ sourcePath?: string; url: string; bytes: number }>;
            };
            if (!Array.isArray(plan.entries)) throw new Error(`cache plan for ${buildId} has no entries`);
            return plan.entries.map((entry) => ({
              sourcePath: entry.sourcePath ?? entry.url,
              url: entry.url,
              bytes: entry.bytes,
            }));
          };
          const previous = await readPlan(previousBuildId);
          const current = await readPlan(afterPublish);
          for (const buildId of [previousBuildId, afterPublish]) {
            await page.goto(
              new URL(`/g/${encodeURIComponent(builds.gameId)}/${encodeURIComponent(buildId)}/`, gamesUrl).toString(),
              { waitUntil: 'networkidle', timeout: 60_000 },
            );
          }
          const samples = current.map((entry) => {
            const url = new URL(entry.url, gamesUrl).toString();
            const captured = networkByUrl.get(url)?.at(-1);
            return { url, transferSize: captured?.transferSize ?? 0 };
          });
          const report = buildAfterPublishReport({
            game,
            buildId: afterPublish,
            previousBuildId,
            previous: previous.map((entry) => ({ ...entry, url: new URL(entry.url, gamesUrl).toString() })),
            current: current.map((entry) => ({ ...entry, url: new URL(entry.url, gamesUrl).toString() })),
            samples,
          });
          return report;
        }

        await page.goto(`${origin}/games`, { waitUntil: 'networkidle', timeout: 60_000 });
        const first = await waitForList();
        await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
        const second = await waitForList();
        const sample = (probe: ImageProbe, occurrence: number): ResourceSample | null => {
          if (!probe) return null;
          const response = networkByUrl.get(probe.url)?.[occurrence];
          if (!response) return null;
          return {
            url: probe.url,
            status: response?.status ?? null,
            transferSize: response.transferSize,
            duration: response.duration,
            cacheControl: response?.cacheControl ?? null,
            cache: response.fromCache
              ? 'cache (memory/disk unknown)'
              : response.transferSize === 0
                ? 'unknown'
                : 'network',
          };
        };
        const firstResources = [sample(first.logo, 0), sample(first.thumbnail, 0)].filter(Boolean) as ResourceSample[];
        const resources = [sample(second.logo, 1), sample(second.thumbnail, 1)].filter(Boolean) as ResourceSample[];
        const apiResponse = second.api ? networkByUrl.get(second.api.url)?.at(-1) : undefined;
        const run: CacheRun = {
          game,
          logoUrl: second.logo?.url,
          thumbnailUrl: second.thumbnail?.url,
          resources,
          firstResources,
          api: second.api
            ? { url: second.api.url, status: apiResponse?.status ?? null, duration: apiResponse?.duration ?? 0 }
            : null,
        };
        return buildGamesCacheReport(run);
      } finally {
        await context.close();
      }
    });
    if ('totalBytesTransferred' in report) {
      if (ctx.json) printJson(ctx, report);
      else {
        ctx.out(`publish cache: ${report.game} ${report.previousBuildId} -> ${report.buildId}`);
        ctx.out(`game files transferred: ${report.totalBytesTransferred} bytes`);
        for (const file of report.changedFiles) ctx.out(`changed: ${file.path} (${file.bytes} bytes)`);
        for (const file of report.unexpectedChanges)
          ctx.out(`unexpected changed URL: ${file.path} (${file.bytes} bytes)`);
        for (const file of report.unexpectedTransfers) ctx.out(`unexpected transfer: ${file.path} ${file.bytes} bytes`);
      }
      return report.ok ? EXIT.ok : EXIT.failed;
    }
    if (ctx.json) printJson(ctx, report);
    else {
      ctx.out(`second load: ${report.game} at ${report.viewport.width}x${report.viewport.height}`);
      for (const [name, image] of [
        ['logo', report.logo],
        ['thumbnail', report.thumbnail],
      ] as const)
        ctx.out(
          `${name}: ${image ? `HTTP ${image.status ?? 'unknown'}, ${image.transferSize} bytes transferred, ${image.duration.toFixed(1)} ms, Cache-Control ${image.cacheControl ?? 'unavailable'}, ${image.cache}` : 'not found'}`,
        );
      ctx.out(
        `games-list API: ${report.gamesListApi ? `${report.gamesListApi.duration.toFixed(1)} ms (HTTP ${report.gamesListApi.status ?? 'unknown'})` : 'not found'}`,
      );
    }
    return report.ok ? EXIT.ok : EXIT.failed;
  },
};
