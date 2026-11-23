import { resolve } from 'node:path';

import type { Tier } from '@ogm/contracts';
import { isLoopbackUrl } from '@ogm/gm-verify/server';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { loadBudgetOverrides, niceCapture } from '../run/index.js';

const TIERS = ['mobile', 'desktop', 'low'] as const;

export const command: GmCommand = {
  name: 'perf',
  summary: 'measure phone-profile load time and resource budgets',
  usage: '[--url loopback] [--device iphone13] [--cpu 4]',
  example: 'perf --device iphone13 --cpu 4 --json',
  flags: {
    url: { type: 'string', help: 'loopback game URL; otherwise serve ./dist' },
    device: { type: 'string', default: 'iphone13', help: 'Playwright device name or iphone13' },
    cpu: { type: 'number', default: 4, help: 'CDP CPU throttle rate' },
    tier: { type: 'string', default: 'mobile', help: 'mobile, desktop or low budget' },
    record: { type: 'string', help: 'directory for the load video and load.log' },
    budgets: { type: 'string', help: 'calibration budget overrides JSON' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help perf');
    if ((flags.cpu as number) < 1) throw new UsageError('--cpu must be at least 1', 'gm perf --cpu 4');
    if (!TIERS.includes(flags.tier as (typeof TIERS)[number]))
      throw new UsageError('--tier must be mobile, desktop or low', 'gm perf --tier mobile');
    const tier = flags.tier as Tier;
    const supplied = typeof flags.url === 'string' ? flags.url : undefined;
    if (supplied && !isLoopbackUrl(supplied))
      throw new UsageError('--url is loopback only', 'gm perf --url http://127.0.0.1:8000/');
    const verify = await import('@ogm/gm-verify');
    const budgetOverrides = loadBudgetOverrides(ctx, flags.budgets, verify.readBudgetOverrides, 'perf');

    niceCapture();
    let server: Awaited<ReturnType<typeof verify.serveStatic>> | undefined;
    let url = supplied;
    if (!url) {
      try {
        server = await verify.serveStatic(resolve(ctx.cwd, 'dist'), { game: true });
        url = server.url;
      } catch {
        throw new UsageError('no built game in ./dist', 'build the game or pass --url http://127.0.0.1:PORT/');
      }
    }
    let browser: Awaited<ReturnType<typeof verify.launch>> | undefined;
    let slot: Awaited<ReturnType<typeof verify.acquireSlot>> | undefined;
    try {
      slot = await verify.acquireSlot({ runtimeDir: ctx.config.runtimeDir });
      browser = await verify.launch(ctx.config.verifySoftwareGl);
      const perf = await verify.measureLoad(browser, url, {
        device: flags.device as string,
        cpu: flags.cpu as number,
        tier,
        ...(typeof flags.record === 'string' ? { recordDir: resolve(ctx.cwd, flags.record) } : {}),
      });
      const bytes = verify.totalBytes(perf);
      const budgets = verify.measureBudgets(
        tier,
        {
          downloadBytes: bytes,
          drawCalls: perf.drawCalls,
          triangles: perf.triangles,
          textureBytes: perf.textureBytes,
        },
        budgetOverrides,
      );
      if (ctx.json) printJson(ctx, { tier, ...perf, budgets });
      else {
        ctx.out(
          `load ${perf.firstMs}ms first  ${perf.cachedMs}ms cached  ${perf.fromNetwork} network  ${perf.fromCache} cache`,
        );
        for (const key of ['downloadBytes', 'drawCalls', 'triangles', 'textureBytes'] as const) {
          const [actual, limit, status] = budgets[key];
          ctx.out(`${key} ${actual} / ${limit} ${status}`);
        }
      }
      return Object.values(budgets).some((budget) => budget[2] === 'over') ? EXIT.failed : EXIT.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('unknown device')) throw new UsageError(message, 'gm perf --device iphone13');
      ctx.err(message);
      return EXIT.failed;
    } finally {
      await browser?.close();
      slot?.release();
      await server?.close();
    }
  },
};
