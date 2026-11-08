import { relative } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { buildUrl, outDir, outFlag, urlFlag, withBrowser } from '../../qa.js';

const VIEWPORTS = { phone: ['phone'], desktop: ['desktop'], both: ['phone', 'desktop'] } as const;

export const command: GmCommand = {
  name: 'qa open',
  summary: 'boot a hosted build on phone and desktop: console errors, renderer, blank frame, time to interactive',
  usage: '--url <build> [--viewport both|phone|desktop] [--out shots/qa]',
  example: 'qa open --url https://<games-host>:10000/g/<game>/<build>/',
  flags: {
    ...urlFlag,
    ...outFlag,
    viewport: { type: 'string', default: 'both', help: 'phone, desktop or both' },
    timeout: { type: 'number', default: 30, help: 'seconds to become interactive' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa open');
    const url = buildUrl(flags, 'open');
    const viewports = VIEWPORTS[flags.viewport as keyof typeof VIEWPORTS];
    if (!viewports) throw new UsageError('--viewport must be both, phone or desktop', 'gm qa open --viewport both');
    const timeout = flags.timeout as number;
    if (!(timeout > 0)) throw new UsageError('--timeout must be positive', 'gm qa open --timeout 30');
    const dir = outDir(ctx, flags);
    const { qaOpen } = await import('@ogm/gm-verify');
    const result = await withBrowser(ctx, (browser) =>
      qaOpen(browser, url, { outDir: dir, viewports: [...viewports], timeoutMs: timeout * 1000 }),
    );
    if (ctx.json) printJson(ctx, { out: relative(ctx.cwd, dir) || '.', ...result });
    else {
      for (const v of result.viewports) {
        const tti = v.ttiMs === null ? 'never interactive' : `interactive ${v.ttiMs}ms`;
        ctx.out(`${v.viewport} ${v.failures.length === 0 ? 'pass' : 'fail'}  ${tti}  ${v.renderer}  ${v.still}`);
        for (const failure of v.failures) ctx.out(`  ${failure}`);
      }
      ctx.out(`${result.verdict} ${relative(ctx.cwd, dir) || '.'}/qa-open.json`);
    }
    return result.verdict === 'pass' ? EXIT.ok : EXIT.failed;
  },
};
