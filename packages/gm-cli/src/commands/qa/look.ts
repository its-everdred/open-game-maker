import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { ledgerRules, outDir, outFlag } from '../../qa.js';

export const command: GmCommand = {
  name: 'qa look',
  summary: 'look questions from the journey expects and the feedback ledger; --report writes qa-report.md',
  usage: '[--out shots/qa] [--report]',
  example: 'qa look --report',
  flags: {
    ...outFlag,
    report: { type: 'boolean', default: false, help: 'write qa-report.md from the results and look/answers.json' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa look');
    const dir = outDir(ctx, flags);
    if (!existsSync(dir))
      throw new UsageError(`no qa run in ${relative(ctx.cwd, dir)}`, 'gm qa open --url <build> first');
    const verify = await import('@ogm/gm-verify');
    const rules = ledgerRules(ctx);
    const { requests, answersPath } = verify.writeLookRequests(dir, rules);
    const answers = relative(ctx.cwd, answersPath);
    if (!flags.report) {
      if (ctx.json) printJson(ctx, { dir: relative(ctx.cwd, dir) || '.', requests, answers });
      else {
        for (const request of requests) {
          ctx.out(`${request.id}: ${request.images.map((image) => relative(ctx.cwd, join(dir, image))).join(' ')}`);
          for (const q of request.questions) ctx.out(`  ${q.id} ${q.text}`);
        }
        ctx.out(`answer each id in ${answers} with {"pass": true|false, "note": "..."}, then gm qa look --report`);
      }
      return EXIT.ok;
    }
    const report = verify.writeQaReport(dir, rules);
    const shown = relative(ctx.cwd, report.path);
    if (ctx.json) printJson(ctx, { verdict: report.verdict, report: shown });
    else ctx.out(`${report.verdict} ${shown}`);
    return report.verdict === 'pass' ? EXIT.ok : EXIT.failed;
  },
};
