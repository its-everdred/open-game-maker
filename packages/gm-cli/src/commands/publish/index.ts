import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError, loadEnv } from '@ogm/config';

import { checkPublishDist } from '../../dist-validation.js';
import { CommandError, EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { scanReferences, unlisted } from '../../references.js';
import { mergePrototypeReviews, parsePrototypeReview } from '../../prototype-review.js';
import { publishSandboxEnv, writePublishSandbox } from '../../publish-sandbox.js';
import { publishBuildHash } from '../../publish-build-hash.js';
import { readPublishLock, stagePublishAssets } from '../../publish-assets.js';
import { safePublishTestScript } from '../../publish-test-script.js';

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
  OGM_GAMES_ORIGIN: { kind: 'url', required: false },
  OGM_ASSETS_ROOT: { kind: 'path', required: false },
  OGM_BLOB_ROOT: { kind: 'path', required: false },
  OGM_PUBLISH_BUILD_TIMEOUT_MS: { kind: 'int', default: '1800000' },
} as const;

const OUTPUT_BYTES = 64 * 1024 * 1024;
// The archive the daemon's hook uploads: dist/ plus the repository's own manifest, base design and achievements.
const FROM_REPO = ['manifest.json', 'design/design.json', 'achievements.json'];

type Facts = {
  gameId: string;
  slug: string;
  repoPath: string;
  repoVisibility: 'public' | 'private';
  checkout: string;
  repo: { owner: string; name: string };
  lastReviewedSha: string | null;
  previousBuildSha: string | null;
};

class RequestUncertain extends CommandError {}
class RequestTimeout extends RequestUncertain {}

/** `NAME=value` lines of one env file, read without sourcing it (the files also hold secrets). */
export function readEnvFile(file: string): Record<string, string> {
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

export function hostEnv(ctx: GmContext, home: string) {
  // OGM_ENV_DIR names the host's env directory, as for the other host tools.
  const file = readEnvFile(join(ctx.env?.OGM_ENV_DIR || join(home, '.config', 'ogm', 'env'), 'api.env'));
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

/** Reuse generated asset work from the registered checkout; cache entries remain content-addressed and validated. */
export function seedAssetCache(sourceGame: string, targetGame: string): void {
  const source = join(sourceGame, '.gm', 'cache', 'assets');
  if (!existsSync(source)) return;
  const target = join(targetGame, '.gm', 'cache', 'assets');
  const copyRegularTree = (from: string, to: string): void => {
    let info;
    try {
      info = lstatSync(from);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from)) copyRegularTree(join(from, name), join(to, name));
    } else if (info.isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
  };
  copyRegularTree(source, target);
}

/** fetch's own message is a bare "fetch failed"; the socket's reason sits on its cause. */
function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause : null;
  if (!cause) return error.message;
  const code = (cause as { code?: unknown }).code;
  return `${error.message} (${typeof code === 'string' ? `${code}: ` : ''}${cause.message})`;
}

/*
 * A connection that drops before an answer (#646: the first upload after a long build failed with "fetch failed" and
 * an immediate rerun published) is tried once more. A timeout is not, as the API may still be working on the request,
 * and nor is an answer that breaks off: the API has acted by then, and a second upload would publish a second build.
 */
export async function request(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      if (attempt === 1 && !timedOut) continue;
      if (timedOut) throw new RequestTimeout(`no answer from ${url}: ${reason(error)}`);
      throw new RequestUncertain(`no answer from ${url}: ${reason(error)}`);
    }
    try {
      return { status: response.status, body: await response.text() };
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new RequestTimeout(`the answer from ${url} timed out (HTTP ${response.status}): ${reason(error)}`);
      throw new RequestUncertain(`the answer from ${url} broke off (HTTP ${response.status}): ${reason(error)}`);
    }
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
  let answer: {
    game?: {
      id?: string;
      slug?: string | null;
      repoVisibility?: 'public' | 'private' | null;
      repo?: { path?: string | null; owner?: string | null; name?: string | null };
    };
    daemon?: { checkoutPath?: string | null } | null;
    latestPrototypeReview?: { sha?: string } | null;
    build?: { gitSha?: string } | null;
  };
  try {
    answer = JSON.parse(body) as typeof answer;
  } catch {
    throw new CommandError(`the API's answer for game "${slug}" is not JSON: ${body.slice(0, 200)}`);
  }
  const gameId = answer.game?.id ?? '';
  const repoPath = answer.game?.repo?.path ?? '';
  if (!gameId) throw new CommandError(`the API's answer for "${slug}" carried no game id`);
  if (!repoPath) throw new UsageError(`game "${slug}" has no repository folder registered`, 'register the game first');
  return {
    gameId,
    slug: answer.game?.slug || slug,
    repoPath,
    repoVisibility: answer.game?.repoVisibility === 'private' ? 'private' : 'public',
    checkout: answer.daemon?.checkoutPath ?? '',
    repo: { owner: answer.game?.repo?.owner ?? '', name: answer.game?.repo?.name ?? '' },
    lastReviewedSha: answer.latestPrototypeReview?.sha ?? null,
    previousBuildSha: answer.build?.gitSha ?? null,
  };
}

export const command: GmCommand = {
  name: 'publish',
  summary: "build a registered game at its repository's main (or a commit) and publish it",
  usage: '[<slug>] [--sha <ref>] [--checkout <path>] [--api <url>] [--keep] [--dry-run]',
  example: 'publish blobs --sha 4a3e51ee',
  flags: {
    sha: { type: 'string', help: "commit or ref to build (default the game repository's remote main)" },
    checkout: { type: 'string', help: "repository checkout to build from (default the game daemon's checkout)" },
    api: { type: 'string', help: 'API base URL (default http://127.0.0.1:$OGM_API_PORT from api.env)' },
    keep: { type: 'boolean', default: false, help: 'keep the scratch worktree and the archive' },
    'dry-run': { type: 'boolean', default: false, help: 'show registered game facts without building or publishing' },
  },
  async run(ctx, args, flags) {
    if (args.length > 1) throw new UsageError('gm publish takes at most one game slug', 'gm help publish');
    const slug = args[0] ?? slugFromCwd(ctx.cwd);
    const home = ctx.home ?? homedir();
    const env = hostEnv(ctx, home);
    if (env.OGM_PUBLISH_BUILD_TIMEOUT_MS < 1)
      throw new UsageError(
        'OGM_PUBLISH_BUILD_TIMEOUT_MS must be positive',
        'set a positive millisecond value in api.env',
      );
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
    if (flags['dry-run'] === true) {
      if (ctx.json) printJson(ctx, facts);
      else ctx.out(`registered ${facts.slug}: ${facts.repoPath} (${facts.gameId})`);
      return EXIT.ok;
    }
    const checkout = typeof flags.checkout === 'string' ? flags.checkout : facts.checkout;
    if (!checkout) throw new UsageError('no checkout', 'pass --checkout <path> or register the game with a daemon');
    if (!existsSync(checkout)) throw new UsageError(`checkout not found: ${checkout}`, 'pass --checkout <path>');

    // The build never sees the token; a fetch that wants credentials fails instead of prompting.
    const childEnv: Record<string, string | undefined> = { ...ctx.env, GIT_TERMINAL_PROMPT: '0' };
    delete childEnv.OGM_INTERNAL_TOKEN;
    let sandboxProfile: string | undefined;
    const exec = (
      cmd: string,
      cmdArgs: string[],
      cwd: string,
      extraEnv: Record<string, string> = {},
      timeout = 300_000,
    ) => {
      const sandboxed = cmd === 'pnpm';
      if (sandboxed && !sandboxProfile) throw new CommandError('game check sandbox is not configured');
      const sandboxTmp = sandboxed ? mkdtempSync(join(cwd, '.gm-publish-tmp-')) : '';
      const result = spawnSync(
        sandboxed ? 'codex' : cmd,
        sandboxed
          ? ['sandbox', '-P', 'gamebuilder', '--sandbox-state-disable-network', '-C', cwd, '--', cmd, ...cmdArgs]
          : cmdArgs,
        {
          cwd,
          env: sandboxed
            ? publishSandboxEnv(
                { ...childEnv, HOME: home, TMPDIR: sandboxTmp, XDG_RUNTIME_DIR: sandboxTmp, ...extraEnv },
                sandboxProfile!,
              )
            : { ...childEnv, ...extraEnv },
          encoding: 'utf8',
          maxBuffer: OUTPUT_BYTES,
          timeout,
        },
      );
      if (sandboxTmp) rmSync(sandboxTmp, { recursive: true, force: true });
      return {
        ok: result.status === 0,
        timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
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
    const previousOriginMainSha = revParse('refs/remotes/origin/main');
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
    sandboxProfile = join(scratch, 'sandbox-profile');
    mkdirSync(sandboxProfile, { mode: 0o700 });
    const assetsRoot = ctx.env?.OGM_ASSETS_ROOT ? ctx.assetsRoot : (env.OGM_ASSETS_ROOT ?? ctx.assetsRoot);
    const blobRoot = ctx.env?.OGM_BLOB_ROOT ? ctx.blobRoot : (env.OGM_BLOB_ROOT ?? ctx.blobRoot);
    const protectedRoots = [assetsRoot, blobRoot]
      .filter((root): root is string => !!root)
      .flatMap((root) => (existsSync(root) ? [root, realpathSync(root)] : [root]));
    const stagedAssets = join(scratch, 'assets');
    writePublishSandbox(sandboxProfile, home, workRoot, work, protectedRoots, [stagedAssets]);
    const archive = join(workRoot, `${facts.slug}-${commit}.tgz`);
    let stage: string | null = null;
    let testArtifactSha256: string | undefined;
    let checkedSizes: string[] = [];
    try {
      const added = git(['worktree', 'add', '--quiet', '--detach', work, commit]);
      if (!added.ok) throw new CommandError(`cannot check ${commit} out of ${checkout}: ${tail(added.err, 3)}`);
      const game = join(work, facts.repoPath);
      if (!existsSync(join(game, 'package.json'))) {
        throw new CommandError(`${facts.repoPath} has no package.json in ${checkout} at ${commit}`);
      }
      if (!existsSync(join(work, 'docs', facts.slug, 'decisions.json')))
        say(`review gate: no docs/${facts.slug}/decisions.json; prototype review is not configured`);
      // The game's own build script is its production build; a script that already names a base or a mode keeps it.
      // The base stays relative because the games host serves every build under /g/<gameId>/<buildId>/.
      // The asset list is what ships: refuse before building when the code names an asset the list lacks.
      const record = async (checks: { name: string; result: 'passed' | 'failed' }[], artifactSha256?: string) => {
        const response = await request(
          `${api}/internal/operator/games/${encodeURIComponent(facts.slug)}/publish-checks`,
          {
            method: 'POST',
            headers: { 'x-ogm-internal': token, 'content-type': 'application/json' },
            body: JSON.stringify({
              gitSha: commit,
              surface: 'game',
              sizes: checkedSizes,
              checks,
              ...(artifactSha256 ? { artifactSha256 } : {}),
              ...(testArtifactSha256 ? { testArtifactSha256 } : {}),
            }),
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (response.status !== 201) throw new CommandError(`cannot record game checks (HTTP ${response.status})`);
        const value = JSON.parse(response.body) as { id?: unknown };
        if (typeof value.id !== 'string') throw new CommandError('game check record has no id');
        return value.id;
      };
      const checks: { name: string; result: 'passed' | 'failed' }[] = [];
      const failCheck = async (name: string) => {
        checks.push({ name, result: 'failed' });
        await record(checks);
      };
      let listed: string[];
      try {
        listed = (await readPublishLock(game))?.assets.map((entry) => entry.id) ?? [];
      } catch (error) {
        await failCheck('asset lock');
        throw new CommandError(
          `cannot read game asset lock: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const missingAssets = unlisted(listed, await scanReferences(game));
      if (missingAssets.length > 0) {
        await failCheck('asset references');
        const lines = missingAssets.map(({ id, file }) => `${id} (${file})`).join('\n');
        throw new CommandError(
          `assets.lock.json does not list assets the code uses:\n${lines}\nTry: gm assets use <id>`,
        );
      }
      checks.push({ name: 'asset references', result: 'passed' });

      const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8')) as {
        scripts?: { build?: string; test?: string };
      };
      const script = pkg.scripts?.build ?? '';
      if (!script) {
        await failCheck('build script present');
        throw new CommandError(`${facts.repoPath} has no build script`);
      }
      if (!pkg.scripts?.test) {
        await failCheck('test script present');
        throw new CommandError(`${facts.repoPath} has no game test script`);
      }
      const extra = [
        ...(script.includes('--base') ? [] : ['--base=./']),
        ...(script.includes('--mode') ? [] : ['--mode=published']),
      ];
      const buildEnv: Record<string, string> = { NODE_ENV: 'production' };
      try {
        await stagePublishAssets(game, stagedAssets, assetsRoot ?? null, blobRoot ?? null, facts.repoVisibility);
        checks.push({ name: 'asset rights and files', result: 'passed' });
      } catch (error) {
        await failCheck('asset rights and files');
        throw new CommandError(`cannot stage game assets: ${error instanceof Error ? error.message : String(error)}`);
      }
      buildEnv.OGM_ASSETS_ROOT = stagedAssets;
      buildEnv.OGM_BLOB_ROOT = join(stagedAssets, 'blob-store');
      buildEnv.GM_ASSET_CACHE_DIR = mkdtempSync(join(work, '.gm-assets-cache-'));

      const install = exec('pnpm', ['install', '--frozen-lockfile', '--offline'], work, buildEnv);
      if (!install.ok) {
        await failCheck('dependency install');
        throw new CommandError(`pnpm install failed in the worktree:\n${tail(install.err || install.out)}`);
      }
      checks.push({ name: 'dependency install', result: 'passed' });
      const buildTimeout = env.OGM_PUBLISH_BUILD_TIMEOUT_MS;
      const build = exec(
        'pnpm',
        ['run', 'build', ...(extra.length ? ['--', ...extra] : [])],
        game,
        buildEnv,
        buildTimeout,
      );
      if (!build.ok) await failCheck('pnpm run build');
      if (build.timedOut)
        throw new CommandError(`the game's build timed out after ${Math.ceil(buildTimeout / 1000)} s`);
      if (!build.ok) throw new CommandError(`the game's build failed:\n${tail(`${build.out}\n${build.err}`)}`);
      checks.push({ name: 'pnpm run build', result: 'passed' });
      const dist = join(game, 'dist');
      let productionHash: string;
      const productionSnapshot = join(scratch, 'production-dist');
      try {
        productionHash = publishBuildHash(dist);
        cpSync(dist, productionSnapshot, { recursive: true, verbatimSymlinks: true });
        for (const file of FROM_REPO) {
          if (!existsSync(join(game, file))) continue;
          mkdirSync(dirname(join(productionSnapshot, file)), { recursive: true });
          cpSync(join(game, file), join(productionSnapshot, file), { verbatimSymlinks: true });
        }
      } catch (error) {
        await failCheck('production snapshot');
        throw new CommandError(
          `cannot snapshot the production build: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      checks.push({ name: 'production snapshot', result: 'passed' });

      // The SDK strips its test hooks from published builds. A gm test script needs a test-mode build,
      // while the immutable production snapshot remains outside the game sandbox.
      const needsTestBuild = /^\s*gm\s+test(?:\s|$)/u.test(pkg.scripts.test);
      if (needsTestBuild && !safePublishTestScript(pkg.scripts.test)) {
        await failCheck('test configuration');
        throw new CommandError('gm test must use the default dist directory and simple arguments');
      }
      let testBuildHash: string | undefined;
      if (needsTestBuild) {
        checks.push({ name: 'test configuration', result: 'passed' });
        const testBuild = exec(
          'pnpm',
          ['exec', 'vite', 'build', '--mode', 'test', '--base=./'],
          game,
          buildEnv,
          buildTimeout,
        );
        if (!testBuild.ok) {
          await failCheck('test-mode build');
          throw new CommandError(`the game's test-mode build failed:\n${tail(`${testBuild.out}\n${testBuild.err}`)}`);
        }
        checks.push({ name: 'test-mode build', result: 'passed' });
        const testArchive = join(scratch, 'test-build.tgz');
        const packed = exec('tar', ['--format=ustar', '-czf', testArchive, '-C', join(game, 'dist'), '.'], workRoot);
        if (!packed.ok) {
          await failCheck('test-mode archive');
          throw new CommandError(`cannot identify the test build: ${tail(packed.err, 3)}`);
        }
        testArtifactSha256 = createHash('sha256').update(readFileSync(testArchive)).digest('hex');
        testBuildHash = publishBuildHash(dist);
      }
      const test = exec('pnpm', ['run', 'test'], game, buildEnv, buildTimeout);
      if (!test.ok) await failCheck('pnpm run test');
      if (test.timedOut) throw new CommandError(`the game's tests timed out after ${Math.ceil(buildTimeout / 1000)} s`);
      if (!test.ok) throw new CommandError(`the game's tests failed:\n${tail(`${test.out}\n${test.err}`)}`);
      checks.push({ name: 'pnpm run test', result: 'passed' });
      if (needsTestBuild && publishBuildHash(dist) !== testBuildHash) {
        await failCheck('test build integrity');
        throw new CommandError('the game checks changed the test build');
      }
      if (needsTestBuild) {
        checks.push({ name: 'test build integrity', result: 'passed' });
        checkedSizes = ['390x844', '1180x820'];
      }
      if (!needsTestBuild && publishBuildHash(dist) !== productionHash) {
        await failCheck('production build integrity');
        throw new CommandError('the game checks changed the production build');
      }
      const problems = checkPublishDist(productionSnapshot);
      if (!needsTestBuild) checks.push({ name: 'production build integrity', result: 'passed' });
      checks.push({ name: 'publish artifact', result: problems.length ? 'failed' : 'passed' });
      if (problems.length) {
        await record(checks);
        throw new CommandError(problems[0]!);
      }

      stage = mkdtempSync(join(workRoot, `${facts.slug}-stage.`));
      cpSync(productionSnapshot, stage, { recursive: true, verbatimSymlinks: true });
      // The API's unpacker reads ustar only.
      const tar = exec('tar', ['--format=ustar', '-czf', archive, '-C', stage, '.'], workRoot);
      if (!tar.ok) throw new CommandError(`cannot archive the build: ${tail(tar.err, 3)}`);
      const checkId = await record(checks, createHash('sha256').update(readFileSync(archive)).digest('hex'));

      const requestId = `j_${randomUUID()}`;
      const uploadUrl = `${api}/internal/operator/games/${encodeURIComponent(facts.slug)}/builds`;
      const recover = async () => {
        // The request id identifies this exact publish, including a retry after a lost connection.
        const deadline = Date.now() + 90_000;
        do {
          const check = await request(`${uploadUrl}/${requestId}`, {
            headers: { 'x-ogm-internal': token },
            signal: AbortSignal.timeout(20_000),
          }).catch(() => null);
          if (check?.status === 200) {
            try {
              const result = JSON.parse(check.body) as {
                state?: string;
                buildId?: string | null;
                publishResult?: string;
              };
              if (result.state === 'done' && result.buildId)
                return {
                  status: 201,
                  body: JSON.stringify({
                    buildId: result.buildId,
                    jobId: requestId,
                    publishResult: result.publishResult,
                  }),
                };
              if (!result.state || result.state === 'failed' || result.state === 'cancelled') return null;
            } catch {
              return null;
            }
          } else if (check?.status !== 404) return null;
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        } while (Date.now() < deadline);
        return null;
      };
      let upload: { status: number; body: string };
      try {
        upload = await request(uploadUrl, {
          method: 'POST',
          headers: {
            'x-ogm-internal': token,
            'x-gm-sha': commit,
            'x-gm-check-id': checkId,
            'x-gm-request-id': requestId,
            'content-type': 'application/gzip',
          },
          body: readFileSync(archive),
          signal: AbortSignal.timeout(300_000),
        });
      } catch (error) {
        if (!(error instanceof RequestUncertain)) throw error;
        const recovered = await recover();
        if (!recovered) throw error;
        upload = recovered;
      }
      if (upload.status >= 500) upload = (await recover()) ?? upload;
      let answer: Record<string, unknown> = {};
      try {
        answer = JSON.parse(upload.body) as Record<string, unknown>;
      } catch {
        // A non-JSON answer is reported as text below.
      }

      if (upload.status === 201) {
        const buildId = String(answer.buildId ?? '');
        const play = `${env.OGM_GAMES_ORIGIN?.replace(/\/+$/, '') ?? ''}/g/${encodeURIComponent(facts.gameId)}/${encodeURIComponent(buildId)}/`;
        if (answer.publishResult !== 'published') {
          const outcome = answer.publishResult === 'skipped' ? 'skipped' : 'unknown';
          if (ctx.json)
            printJson(ctx, {
              state: 'done',
              slug: facts.slug,
              gameId: facts.gameId,
              sha: commit,
              buildId,
              jobId: answer.jobId,
              publishResult: outcome,
              play,
            });
          else ctx.out(`built ${facts.repoPath} at ${commit}: build ${buildId}; automatic release ${outcome}`);
          return EXIT.ok;
        }
        let reviewState: 'posted' | 'existing' | 'failed' | 'skipped' = 'skipped';
        let reviewRoundId: string | undefined;
        let publishAttention = '';
        const retryBase =
          facts.previousBuildSha === commit ? exec('git', ['rev-parse', `${commit}^`], checkout).out.trim() : null;
        const base = facts.lastReviewedSha ?? retryBase ?? facts.previousBuildSha ?? previousOriginMainSha;
        const reviewBodies: string[] = [];
        const missingReviewPrs: string[] = [];
        let sourceTickets: string[] = [];
        let mergedPrCount = 0;
        if (base && facts.repo.owner && facts.repo.name) {
          const commits = git(['log', '--first-parent', '--reverse', '--format=%H%x09%s', `${base}..${commit}`]);
          if (commits.ok) {
            const commitLines = commits.out.trim().split('\n').filter(Boolean);
            for (const line of commitLines) {
              const [sha, subject] = line.split('\t', 2);
              const number = subject?.match(/(?:Merge pull request #|\(#)(\d+)\)?/u)?.[1];
              if (!number || !sha) continue;
              mergedPrCount += 1;
              const pr = exec(
                'gh',
                [
                  'pr',
                  'view',
                  number,
                  '--repo',
                  `${facts.repo.owner}/${facts.repo.name}`,
                  '--json',
                  'body',
                  '--jq',
                  '.body',
                ],
                checkout,
              );
              if (!pr.ok) {
                missingReviewPrs.push(`#${number} (could not read PR body)`);
                reviewBodies.push('');
                continue;
              }
              reviewBodies.push(pr.out);
              if (parsePrototypeReview(pr.out).disposition === 'missing') missingReviewPrs.push(`#${number}`);
              for (const match of pr.out.matchAll(/\b(?:closes?|fixes?|resolves?|refs?)\s+#([1-9]\d*)/giu))
                sourceTickets.push(match[1]!);
              void sha;
            }
            if (commitLines.length > 0 && mergedPrCount === 0)
              publishAttention = 'Could not identify merged PRs in the published commit range.';
          } else publishAttention = 'Could not inspect the merged commits since the last reviewed build.';
        } else if (!facts.repo.owner || !facts.repo.name)
          publishAttention = 'The game repository is not configured; merged PR review sections could not be checked.';
        else if (!base) publishAttention = 'Could not find a baseline commit for the prototype review range.';
        sourceTickets = [...new Set(sourceTickets)];
        if (sourceTickets.length > 20) {
          sourceTickets = sourceTickets.slice(0, 20);
          publishAttention ||=
            'The publish review references more than 20 source tickets; only the first 20 are attached.';
        }
        const review = mergePrototypeReviews(reviewBodies);
        if (review.disposition === 'none' || (mergedPrCount === 0 && !publishAttention)) {
          const checked = await request(
            `${api}/internal/operator/games/${encodeURIComponent(facts.slug)}/builds/${encodeURIComponent(buildId)}/prototype-review-check`,
            { method: 'POST', headers: { 'x-ogm-internal': token }, signal: AbortSignal.timeout(20_000) },
          ).catch((error: unknown) => ({ status: 0, body: error instanceof Error ? error.message : String(error) }));
          if (checked.status < 200 || checked.status >= 300)
            publishAttention ||= `Published build ${buildId}, but its no-review disposition could not be recorded (HTTP ${checked.status}).`;
        } else if (mergedPrCount > 0 || publishAttention) {
          if (review.disposition === 'missing') {
            const prs = missingReviewPrs.length ? missingReviewPrs.join(', ') : 'one or more merged PRs';
            publishAttention ||= `${prs} lack a ## Prototype review section; posted the fallback review.`;
          }
          const inventory = base
            ? git(['show', `${commit}:docs/${facts.slug}/decisions.json`])
            : { ok: false, out: '' };
          let decisionIds: string[] = [];
          if (inventory.ok) {
            try {
              const entries = JSON.parse(inventory.out) as { id: string; status: string }[];
              const statuses = new Map(entries.map((entry) => [entry.id, entry.status]));
              const candidates = review.decisionIds
                .filter((id) => /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id))
                .filter((id) => ['open', 'asked'].includes(statuses.get(id) ?? ''));
              const preferred = candidates.filter((id) => statuses.get(id) === 'asked');
              const remaining = candidates.filter((id) => statuses.get(id) === 'open');
              const ordered = [...preferred, ...remaining];
              decisionIds = ordered.slice(0, 6);
            } catch {
              publishAttention ||= 'The decision inventory could not be read; posted without weigh-in ids.';
            }
          }
          const media: { kind: 'build' | 'clip' | 'still'; ref: string; hasAudio?: boolean; scenario?: string }[] = [
            { kind: 'build', ref: buildId, ...(review.scenario ? { scenario: review.scenario } : {}) },
          ];
          let clipStatus: 'captured' | 'unchecked' = 'unchecked';
          const gamesOrigin = env.OGM_GAMES_ORIGIN?.replace(/\/+$/, '');
          const captureDir = join(workRoot, `${facts.slug}.review-${buildId}`);
          const uploadMedia = async (path: string, mime: 'video/mp4' | 'image/png') => {
            try {
              const uploaded = await request(
                `${api}/internal/operator/games/${encodeURIComponent(facts.slug)}/prototype-reviews/media`,
                {
                  method: 'POST',
                  headers: { 'x-ogm-internal': token, 'content-type': mime },
                  body: readFileSync(path),
                  signal: AbortSignal.timeout(120_000),
                },
              );
              if (uploaded.status !== 201) return null;
              const stored = JSON.parse(uploaded.body) as { hash?: string };
              return stored.hash ?? null;
            } catch {
              return null;
            }
          };
          if (gamesOrigin) {
            const url = `${gamesOrigin}/g/${encodeURIComponent(facts.gameId)}/${encodeURIComponent(buildId)}/`;
            const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
            const qaExecutable = ctx.env?.OGM_QA_GM === 'true' ? 'true' : process.execPath;
            const qaArgs =
              qaExecutable === 'true'
                ? []
                : [
                    join(coreRoot, 'packages/gm-cli/dist/index.js'),
                    'qa',
                    'playtest',
                    game,
                    '--all-modes',
                    '--url',
                    url,
                    '--out',
                    captureDir,
                  ];
            const capture = exec(qaExecutable, qaArgs, work, {}, 600_000);
            if (!capture.ok)
              publishAttention ||= `Prototype playtest capture failed for ${facts.slug}; posted with fallback media.`;
            let clipPath: string | null = null;
            if (existsSync(join(captureDir, 'playtest.json'))) {
              try {
                const runs = JSON.parse(readFileSync(join(captureDir, 'playtest.json'), 'utf8')) as { clip?: string }[];
                const clip = runs.find((run) => run.clip)?.clip;
                if (clip) clipPath = join(captureDir, clip);
              } catch {
                /* retain still fallback below */
              }
            }
            if (clipPath && existsSync(clipPath)) {
              const hash = await uploadMedia(clipPath, 'video/mp4');
              if (hash) {
                media.push({ kind: 'clip', ref: hash, hasAudio: false });
                clipStatus = 'captured';
              }
            }
            if (clipStatus === 'unchecked') {
              const pngs: string[] = [];
              const visit = (directory: string) => {
                if (!existsSync(directory)) return;
                for (const entry of readdirSync(directory, { withFileTypes: true })) {
                  const path = join(directory, entry.name);
                  if (entry.isDirectory()) visit(path);
                  else if (/\.png$/iu.test(entry.name)) pngs.push(path);
                }
              };
              visit(captureDir);
              for (const still of pngs.slice(0, 15)) {
                const hash = await uploadMedia(still, 'image/png');
                if (hash) media.push({ kind: 'still', ref: hash });
              }
            }
          } else publishAttention ||= 'The games origin is unavailable; published prototype capture was skipped.';
          if (media.length === 1 && ctx.env?.OGM_QA_GM !== 'true')
            publishAttention ||= `Prototype capture media could not be attached for ${facts.slug}; the playable build is attached without a clip or still.`;
          const bounded = (items: string[], label: string): string[] => {
            const result = [...new Set(items.map((item) => item.slice(0, 240)))].slice(0, 32);
            if (result.length !== items.length || items.some((item) => item.length > 240))
              publishAttention ||= `The publish review's ${label} summary exceeded storage limits and was shortened.`;
            return result;
          };
          const works = bounded(review.works, 'works');
          const limitations = bounded(review.limitations, 'limitations');
          const submission = {
            id: randomUUID(),
            track: 'prototype-publish',
            phase: 'build',
            category: 'gameplay',
            ticket: sourceTickets[0] ?? 'publish',
            ...(sourceTickets.length ? { sourceTickets } : {}),
            sha: commit,
            media,
            question: `Review the published ${facts.slug} build`,
            works,
            limitations: review.disposition === 'missing' ? ['Limitations not stated'] : limitations,
            decisionIds,
            clipStatus,
          };
          const posted = await request(
            `${api}/internal/operator/games/${encodeURIComponent(facts.slug)}/prototype-reviews`,
            {
              method: 'POST',
              headers: { 'x-ogm-internal': token, 'content-type': 'application/json' },
              body: JSON.stringify(submission),
              signal: AbortSignal.timeout(30_000),
            },
          ).catch((error: unknown) => ({ status: 0, body: error instanceof Error ? error.message : String(error) }));
          if (posted.status < 200 || posted.status >= 300)
            publishAttention ||= `Published build ${buildId}, but prototype review posting failed (HTTP ${posted.status}): ${posted.body}`;
          else {
            try {
              const result = JSON.parse(posted.body) as { id?: string; state?: string };
              reviewState = result.state === 'existing' ? 'existing' : 'posted';
              reviewRoundId = result.id;
            } catch {
              reviewState = 'failed';
            }
          }
          const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
          const hook = join(coreRoot, 'ops/bin/ogm-qa-review-hook');
          const hookArgs = ['--game-publish', facts.slug, buildId, '--api', api, '--repo', coreRoot];
          if (publishAttention) hookArgs.push('--attention-message', publishAttention);
          if (ctx.env?.OGM_QA_ATTENTION) hookArgs.push('--attention', ctx.env.OGM_QA_ATTENTION);
          const checked = exec(
            hook,
            hookArgs,
            coreRoot,
            env.OGM_INTERNAL_TOKEN ? { OGM_INTERNAL_TOKEN: env.OGM_INTERNAL_TOKEN } : {},
            1_200_000 /* the hook plays the game (#1272): two plays of up to 540 s each, capture-slot wait included */,
          );
          if (publishAttention) ctx.err(`attention: ${publishAttention}`);
          if (!checked.ok && checked.out.trim() && !ctx.json) ctx.out(checked.out.trim());
          if (checked.ok && checked.out.trim() && !ctx.json && ctx.env?.OGM_QA_GM !== 'true')
            ctx.out(checked.out.trim());
          if (!checked.ok && !publishAttention)
            ctx.err(`attention: ${checked.err.trim() || `prototype review hook failed for ${buildId}`}`);
        }
        rmSync(join(workRoot, `${facts.slug}.review-${buildId}`), { recursive: true, force: true });
        if (ctx.json) {
          printJson(ctx, {
            state: 'done',
            slug: facts.slug,
            gameId: facts.gameId,
            sha: commit,
            buildId,
            jobId: answer.jobId,
            play,
            prototypeReview: {
              state: reviewState,
              ...(reviewRoundId ? { roundId: reviewRoundId } : {}),
            },
          });
        } else {
          ctx.out(`published ${facts.repoPath} at ${commit}: build ${buildId}`);
          ctx.out(`play ${play}`);
        }
        // The build is published; an unwritable events file must not turn that into a failure and a re-run.
        try {
          ctx.emit('publish.done', { gameId: facts.gameId, sha: commit, buildId });
        } catch (error) {
          ctx.err(
            `published, but the activity event was not written: ${error instanceof Error ? error.message : String(error)}`,
          );
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
