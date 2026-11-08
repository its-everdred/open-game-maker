import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigError, loadEnv } from '@ogm/config';

import { CommandError, EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

/*
 * The operator's publish for a game registered against a repository whose own tickets are not Game Maker jobs: no
 * daemon `before_remove` hook ever stages a build for it, so this builds the game at a commit and uploads the same
 * archive the hook would, through the API's operator routes (#581).
 */

// Read from the environment first, then from the host's api.env; a bad value refuses this command only.
const ENV = {
  OGM_INTERNAL_TOKEN: { kind: 'secret', required: false },
  OGM_API_PORT: { kind: 'port', required: false },
  OGM_APP_ORIGIN: { kind: 'url', required: false },
  OGM_ASSETS_ROOT: { kind: 'path', required: false },
} as const;

const OUTPUT_BYTES = 64 * 1024 * 1024;
const REQUIRED_DIST = ['index.html', 'manifest.json', 'design/design.json', 'credits.json'];
// The archive the daemon's hook uploads: dist/ plus the repository's own manifest, base design and achievements.
const FROM_REPO = ['manifest.json', 'design/design.json', 'achievements.json'];

type Facts = { gameId: string; slug: string; repoPath: string; checkout: string };

/** `NAME=value` lines of one env file, read without sourcing it (the files also hold secrets). */
function readEnvFile(file: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
  return values;
}

function hostEnv(ctx: GmContext, home: string) {
  const file = readEnvFile(join(home, '.config', 'ogm', 'env', 'api.env'));
  const source: Record<string, string> = {};
  for (const name of Object.keys(ENV)) {
    const value = ctx.env?.[name] || file[name];
    if (value) source[name] = value;
  }
  try {
    return loadEnv('gm publish', ENV, source);
  } catch (error) {
    if (error instanceof ConfigError) throw new UsageError(error.message, 'fix the value in ~/.config/ogm/env/api.env');
    throw error;
  }
}

/** The game whose folder holds the nearest gm.manifest.json above cwd; its folder is `games/<slug>`. */
function slugFromCwd(cwd: string): string {
  const refusal = new UsageError('gm publish needs a game slug outside a game folder', 'gm publish <slug>');
  let root: string;
  try {
    root = workspaceRoot(cwd);
  } catch {
    throw refusal;
  }
  const dir = gameDir(cwd, root);
  if (!existsSync(join(dir, 'gm.manifest.json'))) throw refusal;
  return basename(dir);
}

function tail(text: string, lines = 20): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}

async function request(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, init);
    return { status: response.status, body: await response.text() };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CommandError(`no answer from ${url}: ${cause}`);
  }
}

async function readFacts(api: string, token: string, slug: string): Promise<Facts> {
  const url = `${api}/internal/operator/games/${encodeURIComponent(slug)}`;
  const { status, body } = await request(url, {
    headers: { 'x-ogm-internal': token },
    signal: AbortSignal.timeout(20_000),
  });
  if (status === 404) throw new UsageError(`game "${slug}" is not registered at ${api}`, 'register the game first');
  if (status === 401) throw new UsageError(`the API at ${api} refused the internal token`, 'check api.env');
  if (status !== 200) throw new CommandError(`the API answered HTTP ${status} for game "${slug}": ${body}`);
  const answer = JSON.parse(body) as {
    game?: { id?: string; slug?: string | null; repo?: { path?: string | null } };
    daemon?: { checkoutPath?: string | null } | null;
  };
  const gameId = answer.game?.id ?? '';
  const repoPath = answer.game?.repo?.path ?? '';
  if (!gameId) throw new CommandError(`the API's answer for "${slug}" carried no game id`);
  if (!repoPath) throw new UsageError(`game "${slug}" has no repository folder registered`, 'register the game first');
  return { gameId, slug: answer.game?.slug || slug, repoPath, checkout: answer.daemon?.checkoutPath ?? '' };
}

export const command: GmCommand = {
  name: 'publish',
  summary: "build a registered game at its repository's main (or a commit) and publish it",
  usage: '[<slug>] [--sha <ref>] [--checkout <path>] [--api <url>] [--keep]',
  example: 'publish blobs --sha 4a3e51ee',
  flags: {
    sha: { type: 'string', help: "commit or ref to build (default the game repository's remote main)" },
    checkout: { type: 'string', help: "repository checkout to build from (default the game daemon's checkout)" },
    api: { type: 'string', help: 'API base URL (default http://127.0.0.1:$OGM_API_PORT from api.env)' },
    keep: { type: 'boolean', default: false, help: 'keep the scratch worktree and the archive' },
  },
  async run(ctx, args, flags) {
    if (args.length > 1) throw new UsageError('gm publish takes at most one game slug', 'gm help publish');
    const slug = args[0] ?? slugFromCwd(ctx.cwd);
    const home = ctx.home ?? homedir();
    const env = hostEnv(ctx, home);
    if (!env.OGM_INTERNAL_TOKEN) {
      throw new UsageError('no internal token', 'set OGM_INTERNAL_TOKEN in ~/.config/ogm/env/api.env');
    }
    const token = env.OGM_INTERNAL_TOKEN;
    let api = typeof flags.api === 'string' ? flags.api : '';
    if (!api) {
      if (!env.OGM_API_PORT) throw new UsageError('no API port', 'set OGM_API_PORT in api.env or pass --api <url>');
      api = `http://127.0.0.1:${env.OGM_API_PORT}`;
    }
    api = api.replace(/\/+$/, '');
    const say = (line: string) => {
      if (!ctx.json) ctx.out(line);
    };

    const facts = await readFacts(api, token, slug);
    const checkout = typeof flags.checkout === 'string' ? flags.checkout : facts.checkout;
    if (!checkout) throw new UsageError('no checkout', 'pass --checkout <path> or register the game with a daemon');
    if (!existsSync(checkout)) throw new UsageError(`checkout not found: ${checkout}`, 'pass --checkout <path>');

    // The build never sees the token; a fetch that wants credentials fails instead of prompting.
    const childEnv: Record<string, string | undefined> = { ...ctx.env, GIT_TERMINAL_PROMPT: '0' };
    delete childEnv.OGM_INTERNAL_TOKEN;
    const exec = (cmd: string, cmdArgs: string[], cwd: string, extraEnv: Record<string, string> = {}) => {
      const result = spawnSync(cmd, cmdArgs, {
        cwd,
        env: { ...childEnv, ...extraEnv },
        encoding: 'utf8',
        maxBuffer: OUTPUT_BYTES,
      });
      return {
        ok: result.status === 0,
        out: result.stdout ?? '',
        err: `${result.stderr ?? ''}${result.error?.message ?? ''}`,
      };
    };
    const git = (gitArgs: string[]) => exec('git', ['-C', checkout, ...gitArgs], checkout);
    if (!git(['rev-parse', '--git-dir']).ok) throw new UsageError(`not a git checkout: ${checkout}`, 'pass --checkout');
    const revParse = (ref: string) => {
      const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      const commit = result.out.trim();
      return result.ok && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
    };

    // The default is the remote's main as it is now: a stale instance checkout once built a broken old commit.
    let commit: string | null;
    if (typeof flags.sha === 'string') {
      commit = revParse(flags.sha);
      if (!commit) {
        git(['fetch', '--quiet', 'origin']);
        commit = revParse(flags.sha);
      }
      if (!commit) throw new UsageError(`cannot resolve "${flags.sha}" to a commit in ${checkout}`, 'pass a SHA');
    } else {
      const fetched = git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
      if (!fetched.ok) throw new CommandError(`cannot fetch main from ${checkout}'s origin: ${tail(fetched.err, 3)}`);
      commit = revParse('refs/remotes/origin/main');
      if (!commit) throw new CommandError(`origin/main does not name a commit in ${checkout}`);
    }
    say(`building ${facts.repoPath} at ${commit}`);

    const workRoot = join(home, '.local', 'state', 'ogm', 'publish');
    mkdirSync(workRoot, { recursive: true });
    // git refuses a worktree path that already exists, so the scratch directory names a child git creates.
    const scratch = mkdtempSync(join(workRoot, `${facts.slug}.`));
    const work = join(scratch, facts.slug);
    const archive = join(workRoot, `${facts.slug}-${commit}.tgz`);
    let stage: string | null = null;
    try {
      const added = git(['worktree', 'add', '--quiet', '--detach', work, commit]);
      if (!added.ok) throw new CommandError(`cannot check ${commit} out of ${checkout}: ${tail(added.err, 3)}`);
      const game = join(work, facts.repoPath);
      if (!existsSync(join(game, 'package.json'))) {
        throw new CommandError(`${facts.repoPath} has no package.json in ${checkout} at ${commit}`);
      }

      // The game's own build script is its production build; a script that already names a base or a mode keeps it.
      // The base stays relative because the games host serves every build under /g/<gameId>/<buildId>/.
      const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8')) as { scripts?: { build?: string } };
      const script = pkg.scripts?.build ?? '';
      if (!script) throw new CommandError(`${facts.repoPath} has no build script`);
      const extra = [
        ...(script.includes('--base') ? [] : ['--base=./']),
        ...(script.includes('--mode') ? [] : ['--mode=published']),
      ];
      const buildEnv: Record<string, string> = { NODE_ENV: 'production' };
      const assetsRoot = ctx.env?.OGM_ASSETS_ROOT ? ctx.assetsRoot : (env.OGM_ASSETS_ROOT ?? ctx.assetsRoot);
      if (assetsRoot) buildEnv.OGM_ASSETS_ROOT = assetsRoot;

      const install = exec('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], work, buildEnv);
      if (!install.ok)
        throw new CommandError(`pnpm install failed in the worktree:\n${tail(install.err || install.out)}`);
      const build = exec('pnpm', ['run', 'build', ...(extra.length ? ['--', ...extra] : [])], game, buildEnv);
      if (!build.ok) throw new CommandError(`the game's build failed:\n${tail(`${build.out}\n${build.err}`)}`);

      const dist = join(game, 'dist');
      const missing = REQUIRED_DIST.filter((file) => !existsSync(join(dist, file)));
      if (missing.length) throw new CommandError(`the build wrote no ${missing.map((f) => `dist/${f}`).join(', ')}`);
      if (readFileSync(join(dist, 'index.html'), 'utf8').includes('="/assets/')) {
        throw new CommandError('dist/index.html loads assets from the origin root; set a relative base');
      }

      stage = mkdtempSync(join(workRoot, `${facts.slug}-stage.`));
      cpSync(dist, stage, { recursive: true, verbatimSymlinks: true });
      for (const file of FROM_REPO) {
        if (!existsSync(join(game, file))) continue;
        mkdirSync(dirname(join(stage, file)), { recursive: true });
        cpSync(join(game, file), join(stage, file));
      }
      // The API's unpacker reads ustar only.
      const tar = exec('tar', ['--format=ustar', '-czf', archive, '-C', stage, '.'], workRoot);
      if (!tar.ok) throw new CommandError(`cannot archive the build: ${tail(tar.err, 3)}`);

      const upload = await request(`${api}/internal/operator/games/${encodeURIComponent(facts.slug)}/builds`, {
        method: 'POST',
        headers: { 'x-ogm-internal': token, 'x-gm-sha': commit, 'content-type': 'application/gzip' },
        body: readFileSync(archive),
        signal: AbortSignal.timeout(300_000),
      });
      let answer: Record<string, unknown> = {};
      try {
        answer = JSON.parse(upload.body) as Record<string, unknown>;
      } catch {
        // A non-JSON answer is reported as text below.
      }

      if (upload.status === 201) {
        const origin = env.OGM_APP_ORIGIN?.replace(/\/+$/, '') ?? '';
        const play = `${origin}/play/${encodeURIComponent(facts.slug)}`;
        const buildId = String(answer.buildId ?? '');
        ctx.emit('publish.done', { gameId: facts.gameId, sha: commit, buildId });
        if (ctx.json) {
          printJson(ctx, {
            state: 'done',
            slug: facts.slug,
            gameId: facts.gameId,
            sha: commit,
            buildId,
            jobId: answer.jobId,
            play,
          });
        } else {
          ctx.out(`published ${facts.repoPath} at ${commit}: build ${buildId}`);
          ctx.out(`play ${play}`);
        }
        return EXIT.ok;
      }
      if (upload.status === 422) {
        if (ctx.json)
          printJson(ctx, { state: 'failed', slug: facts.slug, gameId: facts.gameId, sha: commit, ...answer });
        else ctx.err(`not published (${commit}): ${upload.body || 'no answer'}`);
        return EXIT.failed;
      }
      throw new CommandError(`the API answered HTTP ${upload.status}: ${upload.body || 'no answer'}`);
    } finally {
      if (stage) rmSync(stage, { recursive: true, force: true });
      if (flags.keep === true) {
        ctx.err(`kept the worktree at ${work} and the archive at ${archive}`);
      } else {
        // Deleting the directory and pruning drops the worktree as `worktree remove --force` would.
        rmSync(scratch, { recursive: true, force: true });
        git(['worktree', 'prune']);
        rmSync(archive, { force: true });
      }
    }
  },
};
