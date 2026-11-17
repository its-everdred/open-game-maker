import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { withBrowser } from '../../qa.js';
import { reviewE2e } from '../../qa-review-e2e.js';
import { readEnvFile } from '../publish/index.js';

function headSha(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export const command: GmCommand = {
  name: 'qa review-e2e',
  summary: 'complete a review round and a three-option Command as the QA creator on the deployed app, at four sizes',
  usage: '[--sha <deployed sha>] [--origin <app origin>] [--out <dir>]',
  example: 'qa review-e2e --sha 56d3dc1a2',
  flags: {
    sha: { type: 'string', help: 'the deployed web commit, which names the stills folder (default: this checkout)' },
    origin: { type: 'string', help: 'the app origin (default: OGM_APP_ORIGIN in api.env)' },
    api: { type: 'string', help: 'the API the host reaches (default: http://127.0.0.1:<OGM_API_PORT>)' },
    out: { type: 'string', help: 'stills folder (default: assets-local/review/app/qa-e2e/<sha>)' },
    'inject-regression': { type: 'boolean', help: 'test only: hide the round note box, which the run must catch' },
    'break-media': { type: 'boolean', help: 'test only: the review picture answers 404, which the run must catch' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa review-e2e');
    const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
    const api = readEnvFile(join(envDir, 'api.env'));
    const qa = readEnvFile(join(envDir, 'qa.env'));
    const origin = ((flags.origin as string | undefined) ?? api.OGM_APP_ORIGIN ?? '').replace(/\/$/, '');
    const apiUrl =
      (flags.api as string | undefined) ?? (api.OGM_API_PORT ? `http://127.0.0.1:${api.OGM_API_PORT}` : '');
    const done = (code: number) => {
      ctx.out(`exit=${code} qa-review-e2e`);
      return code;
    };
    const missing = [
      !origin && 'OGM_APP_ORIGIN (api.env)',
      !apiUrl && 'OGM_API_PORT (api.env)',
      !api.OGM_INTERNAL_TOKEN && 'OGM_INTERNAL_TOKEN (api.env)',
      !(qa.OGM_QA_SESSION_COOKIE_NAME && qa.OGM_QA_SESSION_COOKIE) &&
        'the QA session (qa.env: run ops/bin/ogm-qa-session)',
    ].filter(Boolean);
    if (missing.length) {
      ctx.err(`qa review-e2e: missing ${missing.join(', ')} in ${envDir}`);
      return done(EXIT.failed);
    }
    if (qa.OGM_QA_SESSION_EXPIRES && Date.parse(qa.OGM_QA_SESSION_EXPIRES) <= Date.now()) {
      ctx.err('qa review-e2e: the QA session expired; run ops/bin/ogm-qa-session');
      return done(EXIT.failed);
    }
    const sha = (flags.sha as string | undefined) ?? headSha(ctx.cwd);
    const out = resolve(ctx.cwd, (flags.out as string | undefined) ?? join('assets-local/review/app/qa-e2e', sha));
    let results: Awaited<ReturnType<typeof reviewE2e>>;
    try {
      results = await withBrowser(ctx, (browser) =>
        reviewE2e(browser, {
          origin,
          api: apiUrl.replace(/\/$/, ''),
          internalToken: api.OGM_INTERNAL_TOKEN!,
          cookie: { name: qa.OGM_QA_SESSION_COOKIE_NAME!, value: qa.OGM_QA_SESSION_COOKIE! },
          out,
          injectRegression: flags['inject-regression'] === true,
          breakMedia: flags['break-media'] === true,
          stamp: `${sha
            .slice(0, 12)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`,
        }),
      );
    } catch (error) {
      ctx.err(`qa review-e2e: ${(error as Error).message}`);
      return done(EXIT.failed);
    }
    const ok = results.every((result) => result.ok);
    if (ctx.json) printJson(ctx, { ok, out: relative(ctx.cwd, out) || '.', results });
    else {
      for (const result of results) ctx.out(`${result.viewport} ${result.ok ? 'pass' : `fail: ${result.failure}`}`);
      ctx.out(`stills ${relative(ctx.cwd, out) || '.'}`);
    }
    return done(ok ? EXIT.ok : EXIT.failed);
  },
};
