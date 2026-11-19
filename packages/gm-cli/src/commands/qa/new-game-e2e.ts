import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { NewGameQaApi } from '../../qa-new-game-api.js';
import { cleanupQaGame } from '../../qa-new-game-cleanup.js';
import { hostQaCleanup } from '../../qa-new-game-cleanup-host.js';
import { qaGitHubRequest } from '../../qa-new-game-gh-request.js';
import { QaCreateFenceClient } from '../../qa-new-game-fence.js';
import { newGameParents } from '../../qa-new-game-github.js';
import { runNewGameQa, type NewGameCaptureResult } from '../../qa-new-game-run.js';
import { newGameViewport } from '../../qa-new-game-viewport.js';
import { verifyNewGame } from '../../qa-new-game-verify.js';
import { withBrowser } from '../../qa.js';
import { readEnvFile } from '../publish/index.js';

const LEGACY_QA_GAMES = [
  'g_dd2c5ea5-1d9b-4a03-bfee-d4adab6f0d4a',
  'g_291c020f-112e-4c5f-bb80-7c0098622fcb',
  'g_e5502ee0-f570-4f91-93dc-6a47db61abb8',
] as const;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
] as const;

function headSha(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function urls(origin: string, api: string): { origin: string; api: string } {
  const app = new URL(origin);
  const internal = new URL(api);
  if (
    (app.protocol !== 'https:' && !(app.protocol === 'http:' && app.hostname === '127.0.0.1')) ||
    app.username ||
    app.password ||
    app.pathname !== '/' ||
    app.search ||
    app.hash
  )
    throw new Error('app origin must be an HTTPS origin');
  if (
    internal.protocol !== 'http:' ||
    internal.hostname !== '127.0.0.1' ||
    internal.username ||
    internal.password ||
    internal.pathname !== '/' ||
    internal.search ||
    internal.hash
  )
    throw new Error('internal API must be a loopback HTTP origin');
  return { origin: app.origin, api: internal.origin };
}

export const command: GmCommand = {
  name: 'qa new-game-e2e',
  summary: 'create and clean up a QA game at phone portrait and landscape sizes',
  usage: '[--sha <deployed sha>] [--origin <app origin>] [--api <loopback url>] [--out <dir>]',
  example: 'qa new-game-e2e --sha 56d3dc1a2',
  flags: {
    sha: { type: 'string', help: 'deployed commit used for the evidence folder' },
    origin: { type: 'string', help: 'app origin (default: OGM_APP_ORIGIN in api.env)' },
    api: { type: 'string', help: 'loopback API origin (default: OGM_API_PORT in api.env)' },
    out: { type: 'string', help: 'stills, MP4s and recovery state folder' },
  },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa new-game-e2e');
    const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
    const apiEnv = readEnvFile(join(envDir, 'api.env'));
    const qa = readEnvFile(join(envDir, 'qa.env'));
    const sha = (flags.sha as string | undefined) ?? headSha(ctx.cwd);
    const done = (code: number) => {
      if (!ctx.json) ctx.out(`exit=${code} qa-new-game-e2e`);
      return code;
    };
    if (sha !== 'unknown' && !/^[a-f0-9]{7,40}$/iu.test(sha)) {
      ctx.err('qa new-game-e2e: invalid deployed SHA');
      return done(EXIT.failed);
    }
    const repo = apiEnv.OGM_INSTANCE_REPO ?? '';
    const origin = (flags.origin as string | undefined) ?? apiEnv.OGM_APP_ORIGIN ?? '';
    const apiUrl =
      (flags.api as string | undefined) ?? (apiEnv.OGM_API_PORT ? `http://127.0.0.1:${apiEnv.OGM_API_PORT}` : '');
    if (
      !apiEnv.OGM_INTERNAL_TOKEN ||
      !qa.OGM_QA_SESSION_COOKIE_NAME ||
      !qa.OGM_QA_SESSION_COOKIE ||
      !origin ||
      !apiUrl ||
      !repo
    ) {
      ctx.err('qa new-game-e2e: missing API, repository, internal token or QA session configuration');
      return done(EXIT.failed);
    }
    if (
      qa.OGM_QA_SESSION_EXPIRES &&
      (!Number.isFinite(Date.parse(qa.OGM_QA_SESSION_EXPIRES)) || Date.parse(qa.OGM_QA_SESSION_EXPIRES) <= Date.now())
    ) {
      ctx.err('qa new-game-e2e: the QA session expired; run ops/bin/ogm-qa-session');
      return done(EXIT.failed);
    }
    const out = resolve(
      ctx.cwd,
      (flags.out as string | undefined) ?? join('assets-local/review/app/new-game-e2e', sha),
    );
    let lock: { release(): void } | undefined;
    try {
      const addresses = urls(origin, apiUrl);
      if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo)) throw new Error('invalid instance repository');
      const { acquireSlot } = await import('@ogm/gm-verify');
      lock = await acquireSlot({
        runtimeDir: join(envDir, 'qa-new-game-e2e-lock'),
        slots: 1,
        waitMs: 30 * 60_000,
        pollMs: 1_000,
      });
      // Check cleanup prerequisites before creating anything: a run must not start if it cannot later clean up.
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 15_000 });
      const version = execFileSync('systemctl', ['--user', 'show', '--property=Version', '--value'], {
        encoding: 'utf8',
        timeout: 15_000,
        ...(ctx.env ? { env: ctx.env } : {}),
      }).trim();
      if (!version) throw new Error('cannot reach the host user service manager');
      const request = qaGitHubRequest(ctx.env);
      const githubRepo = (await request('GET', `/repos/${repo}`)) as {
        full_name?: unknown;
        permissions?: { push?: unknown };
      };
      if (
        typeof githubRepo.full_name !== 'string' ||
        githubRepo.full_name.toLowerCase() !== repo.toLowerCase() ||
        githubRepo.permissions?.push !== true
      )
        throw new Error('GitHub credential cannot write the instance repository');
      const api = new NewGameQaApi(addresses.api, apiEnv.OGM_INTERNAL_TOKEN);
      const fence = new QaCreateFenceClient(addresses.api, apiEnv.OGM_INTERNAL_TOKEN);
      const cookie = { name: qa.OGM_QA_SESSION_COOKIE_NAME, value: qa.OGM_QA_SESSION_COOKIE };
      const run = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const probe = `g_qa-fence-probe-${run}`;
      await fence.acquire(probe, run);
      await fence.release(probe, run);
      const result = await runNewGameQa(
        { out, repo, run, legacyIds: LEGACY_QA_GAMES },
        {
          inventory: async () => {
            const inventory = await api.games();
            if (inventory.repo !== repo) throw new Error('configured repository does not match the selected API');
            return inventory.games.map((game) => game.id);
          },
          cleanup: async (id, cleanupRun, ready) => {
            await fence.acquire(id, cleanupRun);
            await cleanupQaGame(
              id,
              repo,
              hostQaCleanup(api, repo, cookie, cleanupRun, request, ctx.env, ready, (gameId) => fence.terminal(gameId)),
            );
            await fence.release(id, cleanupRun);
          },
          release: (id, cleanupRun) => fence.release(id, cleanupRun),
          capture: (created) =>
            withBrowser(ctx, async (browser) => {
              const rows: NewGameCaptureResult[] = [];
              for (const viewport of VIEWPORTS) {
                try {
                  const row = await newGameViewport(browser, {
                    origin: addresses.origin,
                    cookie,
                    out,
                    viewport,
                    onCreated: created,
                    verify: (page, gameId, requestId) =>
                      verifyNewGame(page, gameId, requestId, repo, api, (r, id) => newGameParents(r, id, request)),
                    // The durable manifest owns cleanup after the browser slot has been released.
                    cleanup: async () => undefined,
                  });
                  rows.push(row);
                } catch (error) {
                  rows.push({
                    viewport: `${viewport.width}x${viewport.height}`,
                    ok: false,
                    failures: [error instanceof Error ? error.message.split('\n')[0]! : 'browser setup failed'],
                    stills: [],
                    mp4: null,
                  });
                }
              }
              return rows;
            }),
        },
      );
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      if (ctx.json) printJson(ctx, { ...result, out: relative(ctx.cwd, out) || '.' });
      else {
        for (const row of result.results)
          ctx.out(`${row.viewport} ${row.ok ? 'pass' : `fail: ${row.failures.join('; ')}`}`);
        for (const failure of result.failures) ctx.err(`qa new-game-e2e: ${failure}`);
        ctx.out(`evidence ${relative(ctx.cwd, out) || '.'}`);
      }
      return done(result.ok ? EXIT.ok : EXIT.failed);
    } catch (error) {
      ctx.err(`qa new-game-e2e: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`);
      return done(EXIT.failed);
    } finally {
      lock?.release();
    }
  },
};
