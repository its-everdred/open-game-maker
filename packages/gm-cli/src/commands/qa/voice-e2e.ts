import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { withBrowser } from '../../qa.js';
import { costLine, elevenLabsUsage, voiceE2e } from '../../qa-voice-e2e.js';
import { readEnvFile } from '../publish/index.js';

// Each run replaces the QA game's voice build, so two runs at once (the deploy hook and a manual run) would delete each
// other's build mid-call: one run at a time per host, as the review E2E does.
const LOCK_WAIT_MS = 10 * 60_000;

function headSha(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export const command: GmCommand = {
  name: 'qa voice-e2e',
  summary: 'dictate into a build chat and hold a short voice session as the QA creator, on the deployed app',
  usage: '[--sha <deployed sha>] [--origin <app origin>] [--api <url>] [--out <dir>]',
  example: 'qa voice-e2e --sha 56d3dc1a2',
  flags: {
    sha: { type: 'string', help: 'the deployed commit, which names the stills folder (default: this checkout)' },
    origin: { type: 'string', help: 'the app origin (default: OGM_APP_ORIGIN in api.env)' },
    api: { type: 'string', help: 'the API the host reaches (default: http://127.0.0.1:<OGM_API_PORT>)' },
    out: { type: 'string', help: 'stills and log folder (default: assets-local/review/app/voice-e2e/<sha>)' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa voice-e2e');
    const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
    const api = readEnvFile(join(envDir, 'api.env'));
    const qa = readEnvFile(join(envDir, 'qa.env'));
    const voice = readEnvFile(join(envDir, 'voice-host.env'));
    const origin = ((flags.origin as string | undefined) ?? api.OGM_APP_ORIGIN ?? '').replace(/\/$/, '');
    const apiUrl =
      (flags.api as string | undefined) ?? (api.OGM_API_PORT ? `http://127.0.0.1:${api.OGM_API_PORT}` : '');
    const done = (code: number) => {
      ctx.out(`exit=${code} qa-voice-e2e`);
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
      ctx.err(`qa voice-e2e: missing ${missing.join(', ')} in ${envDir}`);
      return done(EXIT.failed);
    }
    if (qa.OGM_QA_SESSION_EXPIRES && Date.parse(qa.OGM_QA_SESSION_EXPIRES) <= Date.now()) {
      ctx.err('qa voice-e2e: the QA session expired; run ops/bin/ogm-qa-session');
      return done(EXIT.failed);
    }
    const sha = (flags.sha as string | undefined) ?? headSha(ctx.cwd);
    const out = resolve(ctx.cwd, (flags.out as string | undefined) ?? join('assets-local/review/app/voice-e2e', sha));
    let result: Awaited<ReturnType<typeof voiceE2e>>;
    let lock: { release(): void } | undefined;
    try {
      const { acquireSlot } = await import('@ogm/gm-verify');
      const waitMs = Number(ctx.env?.OGM_QA_LOCK_WAIT_MS) || LOCK_WAIT_MS;
      lock = await acquireSlot({
        runtimeDir: join(envDir, 'qa-voice-e2e-lock'),
        slots: 1,
        waitMs,
        pollMs: 1_000,
      }).catch((error: Error) => {
        if (!error.message.startsWith('no free capture slot')) throw error;
        throw new Error(`another voice E2E still held the QA game after ${waitMs} ms`);
      });
      result = await withBrowser(ctx, (browser) =>
        voiceE2e(browser, {
          origin,
          api: apiUrl.replace(/\/$/, ''),
          internalToken: api.OGM_INTERNAL_TOKEN!,
          cookie: { name: qa.OGM_QA_SESSION_COOKIE_NAME!, value: qa.OGM_QA_SESSION_COOKIE! },
          out,
          stamp: `${sha
            .slice(0, 12)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`,
          ...(voice.ELEVENLABS_API_KEY ? { usage: elevenLabsUsage(voice.ELEVENLABS_API_KEY) } : {}),
        }),
      );
    } catch (error) {
      ctx.err(`qa voice-e2e: ${(error as Error).message}`);
      return done(EXIT.failed);
    } finally {
      lock?.release();
    }
    const ok = result.steps.length === 2 && result.steps.every((step) => step.ok);
    if (ctx.json) printJson(ctx, { ok, out: relative(ctx.cwd, out) || '.', ...result });
    else {
      for (const step of result.steps)
        ctx.out(`${step.name} ${step.ok ? `pass${step.detail ? `: ${step.detail}` : ''}` : `fail: ${step.failure}`}`);
      ctx.out(costLine(result.cost));
      ctx.out(`stills ${relative(ctx.cwd, out) || '.'}`);
    }
    return done(ok ? EXIT.ok : EXIT.failed);
  },
};
