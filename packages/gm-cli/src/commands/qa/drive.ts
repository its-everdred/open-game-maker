import { relative } from 'node:path';

import type { ViewportName } from '@ogm/gm-verify';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { buildUrl, outDir, outFlag, readJourneyFlag, urlFlag, withBrowser } from '../../qa.js';
import { appFrame } from '../run/index.js';

export const command: GmCommand = {
  name: 'qa drive',
  summary: 'play a journey on a hosted build with real keyboard and touch input; stills, MP4 and GIF',
  usage: '--url <build> --journey games/<name>/qa/journeys/<j>.json [--viewport phone|desktop] [--out shots/qa]',
  example: 'qa drive --url https://<games-host>:10000/g/<game>/<build>/ --journey qa/journeys/solo-cpu.json',
  flags: {
    ...urlFlag,
    ...outFlag,
    journey: { type: 'string', help: 'a solo journey JSON file' },
    viewport: {
      type: 'string',
      help: "phone, phone-landscape, tablet, tablet-landscape or desktop; default the journey's own",
    },
    app: { type: 'string', help: 'signed-in app play URL; serve the local build inside this shell' },
    storage: { type: 'string', help: 'QA storage state for --app' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa drive');
    if (flags.storage && !flags.app) throw new UsageError('--storage requires --app', 'gm qa drive --app <play-url>');
    const app = flags.app ? appFrame(ctx, flags) : undefined;
    const url = app ? undefined : buildUrl(flags, 'drive');
    if (app && flags.url) throw new UsageError('--app uses the local dist, not --url', 'omit --url');
    const viewport = flags.viewport;
    if (
      viewport !== undefined &&
      !['phone', 'phone-landscape', 'tablet', 'tablet-landscape', 'desktop'].includes(viewport as string)
    )
      throw new UsageError(
        '--viewport must be phone, phone-landscape, tablet, tablet-landscape or desktop',
        'gm qa drive --viewport phone',
      );
    const journey = await readJourneyFlag(ctx, flags, 'drive');
    if (journey.kind === 'room')
      throw new UsageError(`${journey.name} is a room journey`, `gm qa room --journey ${String(flags.journey)}`);
    const dir = outDir(ctx, flags);
    const { driveJourney } = await import('@ogm/gm-verify');
    const verify = await import('@ogm/gm-verify');
    const server = app ? await verify.serveStatic(`${ctx.cwd}/dist`, { game: true }) : undefined;
    let result: Awaited<ReturnType<typeof driveJourney>>;
    try {
      result = await withBrowser(ctx, (browser) =>
        driveJourney(browser, server?.url ?? url!, journey, {
          outDir: dir,
          ...(viewport ? { viewport: viewport as ViewportName } : {}),
          ...(app ? { app } : {}),
        }),
      );
    } finally {
      await server?.close();
    }
    const shown = `${relative(ctx.cwd, dir) || '.'}/${journey.name}`;
    if (ctx.json) printJson(ctx, { out: shown, ...result });
    else {
      for (const step of result.steps)
        ctx.out(`${step.ok ? 'pass' : 'FAIL'} ${step.step}${step.error ? `: ${step.error}` : ''}`);
      for (const entry of result.console) ctx.out(`${entry.level}: ${entry.text} (${entry.count})`);
      if (result.skipped > 0) ctx.out(`skipped ${result.skipped} later steps`);
      for (const note of result.unchecked) ctx.out(`unchecked ${note}`);
      ctx.out(`${result.verdict} ${shown}/journey-result.json`);
    }
    return result.verdict === 'pass' ? EXIT.ok : EXIT.failed;
  },
};
