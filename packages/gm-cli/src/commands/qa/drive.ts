import { relative } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { buildUrl, outDir, outFlag, readJourneyFlag, urlFlag, withBrowser } from '../../qa.js';

export const command: GmCommand = {
  name: 'qa drive',
  summary: 'play a journey on a hosted build with real keyboard and touch input; stills, MP4 and GIF',
  usage: '--url <build> --journey games/<name>/qa/journeys/<j>.json [--viewport phone|desktop] [--out shots/qa]',
  example: 'qa drive --url https://<games-host>:10000/g/<game>/<build>/ --journey qa/journeys/solo-cpu.json',
  flags: {
    ...urlFlag,
    ...outFlag,
    journey: { type: 'string', help: 'a solo journey JSON file' },
    viewport: { type: 'string', help: "phone or desktop; default the journey's own, else desktop" },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa drive');
    const url = buildUrl(flags, 'drive');
    const viewport = flags.viewport;
    if (viewport !== undefined && viewport !== 'phone' && viewport !== 'desktop')
      throw new UsageError('--viewport must be phone or desktop', 'gm qa drive --viewport phone');
    const journey = await readJourneyFlag(ctx, flags, 'drive');
    if (journey.kind === 'room')
      throw new UsageError(`${journey.name} is a room journey`, `gm qa room --journey ${String(flags.journey)}`);
    const dir = outDir(ctx, flags);
    const { driveJourney } = await import('@ogm/gm-verify');
    const result = await withBrowser(ctx, (browser) =>
      driveJourney(browser, url, journey, { outDir: dir, ...(viewport ? { viewport } : {}) }),
    );
    const shown = `${relative(ctx.cwd, dir) || '.'}/${journey.name}`;
    if (ctx.json) printJson(ctx, { out: shown, ...result });
    else {
      for (const step of result.steps)
        ctx.out(`${step.ok ? 'pass' : 'FAIL'} ${step.step}${step.error ? `: ${step.error}` : ''}`);
      if (result.skipped > 0) ctx.out(`skipped ${result.skipped} later steps`);
      for (const note of result.unchecked) ctx.out(`unchecked ${note}`);
      ctx.out(`${result.verdict} ${shown}/journey-result.json`);
    }
    return result.verdict === 'pass' ? EXIT.ok : EXIT.failed;
  },
};
